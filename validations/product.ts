import { z } from "zod";

/**
 * Marketplace validation (PRD §20–22, §24, Phase 4).
 *
 * As everywhere else, `campusId`, `vendorProfileId`, slugs and stock levels are
 * never accepted from the client: campus and store come from the authenticated
 * actor, and stock only moves through the inventory service (Rule 1, Rule 29).
 */

/** ₦1 – ₦1,000,000, expressed in whole kobo (PRD §64). */
export const priceKoboSchema = z
  .number()
  .int("Price must be a whole number of kobo")
  .min(100, "Price must be at least ₦1")
  .max(100_000_000, "Price must be ₦1,000,000 or less");

/** Absolute stock levels. Negative stock is not representable. */
export const stockQuantitySchema = z
  .number()
  .int("Stock must be a whole number")
  .min(0, "Stock cannot be negative")
  .max(1_000_000, "Stock is unrealistically high");

export const productNameSchema = z
  .string()
  .trim()
  .min(2, "Enter a product name")
  .max(100, "Product name is too long")
  .transform((value) => value.replace(/\s+/g, " "));

// ---------------------------------------------------------------------------
// Categories (Campus Admin)
// ---------------------------------------------------------------------------

export const categoryCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Enter a category name")
    .max(60, "Category name is too long")
    .transform((value) => value.replace(/\s+/g, " ")),
  description: z.string().trim().max(300, "Description is too long").optional(),
  sortOrder: z.number().int().min(0).max(9_999).optional(),
});
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;

export const categoryUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    description: z.string().trim().max(300).nullable().optional(),
    sortOrder: z.number().int().min(0).max(9_999).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update",
  });
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;

// ---------------------------------------------------------------------------
// Products (vendor)
// ---------------------------------------------------------------------------

export const productCreateSchema = z.object({
  name: productNameSchema,
  description: z.string().trim().max(2_000, "Description is too long").optional(),
  /** Null means "uncategorised"; an unknown id is rejected by the service. */
  categoryId: z.string().min(1).nullable().optional(),
  priceKobo: priceKoboSchema,
  /** Opening stock. Recorded as a RESTOCK inventory transaction. */
  stockQuantity: stockQuantitySchema.default(0),
  lowStockThreshold: z.number().int().min(0).max(100_000).default(0),
  unitLabel: z.string().trim().max(30, "Unit label is too long").optional(),
  isAvailable: z.boolean().default(true),
});
export type ProductCreateInput = z.infer<typeof productCreateSchema>;

/**
 * Editable product fields. `stockQuantity` is deliberately absent: stock moves
 * only through an inventory adjustment, so that every change leaves a record
 * (PRD §22).
 */
export const productUpdateSchema = z
  .object({
    name: productNameSchema.optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    categoryId: z.string().min(1).nullable().optional(),
    priceKobo: priceKoboSchema.optional(),
    lowStockThreshold: z.number().int().min(0).max(100_000).optional(),
    unitLabel: z.string().trim().max(30).nullable().optional(),
    isAvailable: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update",
  });
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

/**
 * A stock movement a vendor may make themselves.
 *
 * `SALE` is absent on purpose: sales are recorded by the order pipeline
 * (Phase 5), never by a vendor asserting one.
 */
export const inventoryAdjustmentSchema = z.object({
  reason: z.enum(["RESTOCK", "ADJUSTMENT", "RETURN"]),
  /** Signed change. Zero would be a no-op record, so it is rejected. */
  delta: z
    .number()
    .int("Adjust stock by a whole number of units")
    .min(-100_000)
    .max(100_000)
    .refine((value) => value !== 0, { message: "Enter how many units to add or remove" }),
  note: z.string().trim().max(200, "Note is too long").optional(),
});
export type InventoryAdjustmentInput = z.infer<typeof inventoryAdjustmentSchema>;

// ---------------------------------------------------------------------------
// Marketplace browse (student)
// ---------------------------------------------------------------------------

export const PRODUCT_SORTS = [
  "NEWEST",
  "PRICE_ASC",
  "PRICE_DESC",
  "POPULAR",
  "TOP_RATED",
] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

/** `"true"`/`"false"` from a query string. `z.coerce.boolean()` would treat the
 * string "false" as true, which is exactly the wrong default for a filter. */
const queryBoolean = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === "true"));

/**
 * Marketplace search, filter, sort and pagination (PRD §24).
 *
 * `TOP_RATED` and `minRating` arrived with Phase 10. They order and filter on the
 * *store's* aggregate rather than the product's, because a rating is given for a
 * delivered order — the store and the courier — and the platform does not ask a
 * student to score an individual item.
 */
export const marketplaceQuerySchema = z.object({
  /** Free text, matched against product, vendor and category names. */
  q: z.string().trim().max(80).optional(),
  categoryId: z.string().min(1).optional(),
  categorySlug: z.string().min(1).max(60).optional(),
  vendorProfileId: z.string().min(1).optional(),
  minPriceKobo: z.coerce.number().int().min(0).max(100_000_000).optional(),
  maxPriceKobo: z.coerce.number().int().min(0).max(100_000_000).optional(),
  /** Hide out-of-stock and paused products. On by default. */
  inStockOnly: queryBoolean,
  /**
   * Whole-star floor on the selling store's average, 1–5.
   *
   * A floor rather than an exact match: "at least 4 stars" is the question a
   * buyer actually asks. Stores with no ratings yet are excluded by any floor,
   * which is a real cost to new vendors — hence it is opt-in and never a default.
   */
  minRating: z.coerce.number().int().min(1).max(5).optional(),
  sort: z.enum(PRODUCT_SORTS).default("NEWEST"),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  /** Super Admin only; ignored for campus-bound actors (see campusScope). */
  campusId: z.string().min(1).optional(),
})
  .refine(
    (value) =>
      value.minPriceKobo === undefined ||
      value.maxPriceKobo === undefined ||
      value.minPriceKobo <= value.maxPriceKobo,
    { message: "The minimum price must not exceed the maximum", path: ["minPriceKobo"] },
  );
export type MarketplaceQueryInput = z.infer<typeof marketplaceQuerySchema>;

/** Parses `URLSearchParams` into a validated marketplace query. */
export function parseMarketplaceQuery(params: URLSearchParams): MarketplaceQueryInput {
  const raw: Record<string, string> = {};
  for (const key of [
    "q",
    "categoryId",
    "categorySlug",
    "vendorProfileId",
    "minPriceKobo",
    "maxPriceKobo",
    "inStockOnly",
    "minRating",
    "sort",
    "page",
    "pageSize",
    "campusId",
  ]) {
    const value = params.get(key);
    if (value !== null && value !== "") raw[key] = value;
  }
  return marketplaceQuerySchema.parse(raw);
}
