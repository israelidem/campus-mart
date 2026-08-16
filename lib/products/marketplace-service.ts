import type { Actor } from "@/lib/auth/session";
import { assertSameCampus, campusScope } from "@/lib/authorization/campus";
import { prisma } from "@/lib/db/prisma";
import { NotFoundError } from "@/lib/errors";
import { formatAverage } from "@/lib/ratings/rating-policy";
import { isWithinOperatingHours } from "@/lib/vendors/operating-hours";
import type { MarketplaceQueryInput, ProductSort } from "@/validations/product";

/**
 * The student-facing marketplace (PRD §24, Phase 4).
 *
 * Two filters are applied in every query and are not optional: the actor's
 * campus, and `vendorProfile.status = APPROVED`. Both live in
 * `buildMarketplaceWhere` so there is one place to audit, and they are applied
 * by the database rather than by the UI (Rule 25, Rule 29).
 */

export type MarketplaceProduct = {
  id: string;
  name: string;
  slug: string;
  priceKobo: number;
  unitLabel: string | null;
  inStock: boolean;
  soldCount: number;
  imageId: string | null;
  category: { id: string; name: string; slug: string } | null;
  vendor: {
    id: string;
    storeName: string;
    slug: string;
    acceptingOrders: boolean;
    /**
     * The store's reputation, not the product's (PRD §24, §57).
     *
     * `null` when nobody has rated the store yet — deliberately not `0`, so a new
     * store reads as "no ratings" rather than as the worst store on campus.
     */
    ratingAverage: string | null;
    ratingCount: number;
  };
};

export type MarketplacePage = {
  products: MarketplaceProduct[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

/**
 * The `where` clause for a marketplace read.
 *
 * Exported so the isolation and "approved vendors only" rules can be asserted
 * directly in tests without a database.
 */
export function buildMarketplaceWhere(
  actor: Actor,
  query: Pick<
    MarketplaceQueryInput,
    | "q"
    | "categoryId"
    | "categorySlug"
    | "vendorProfileId"
    | "minPriceKobo"
    | "maxPriceKobo"
    | "inStockOnly"
    | "minRating"
    | "campusId"
  >,
): Record<string, unknown> {
  // The vendor constraint is built up separately so the approval rule and an
  // optional rating floor end up in one nested filter rather than two, which
  // Prisma would otherwise resolve as the last one winning.
  const vendorProfile: Record<string, unknown> = { status: "APPROVED" };

  if (query.minRating !== undefined) {
    // Compared in stored hundredths, so "at least 4 stars" is >= 400 and a store
    // averaging 3.99 is correctly excluded.
    vendorProfile.ratingAverageHundredths = { gte: query.minRating * 100 };
    // A store with no ratings has an average of 0 and would already fail the
    // line above; requiring a count as well states the intent rather than
    // relying on that coincidence.
    vendorProfile.ratingCount = { gt: 0 };
  }

  const where: Record<string, unknown> = campusScope(
    actor,
    {
      // Retired products never appear, even to their own vendor's customers.
      deletedAt: null,
      // Only stores that are actually approved right now.
      vendorProfile,
    },
    query.campusId,
  );

  // Default on: a student browsing should not be shown things they cannot buy.
  if (query.inStockOnly !== false) {
    where.isAvailable = true;
    where.stockQuantity = { gt: 0 };
  }

  if (query.categoryId) where.categoryId = query.categoryId;
  if (query.categorySlug) where.category = { slug: query.categorySlug };
  if (query.vendorProfileId) where.vendorProfileId = query.vendorProfileId;

  if (query.minPriceKobo !== undefined || query.maxPriceKobo !== undefined) {
    where.priceKobo = {
      ...(query.minPriceKobo !== undefined ? { gte: query.minPriceKobo } : {}),
      ...(query.maxPriceKobo !== undefined ? { lte: query.maxPriceKobo } : {}),
    };
  }

  if (query.q) {
    // Search spans the product, its store and its category, because students
    // look for "Mama Kemi" and "snacks" as readily as for a product name.
    where.OR = [
      { name: { contains: query.q, mode: "insensitive" } },
      { description: { contains: query.q, mode: "insensitive" } },
      { vendorProfile: { storeName: { contains: query.q, mode: "insensitive" } } },
      { category: { name: { contains: query.q, mode: "insensitive" } } },
    ];
  }

  return where;
}

/**
 * Sort order for a marketplace read.
 *
 * "Popular" uses units sold; "top rated" uses the selling store's stored average
 * (Phase 10). Every branch ends in `id` so that two rows with identical keys keep
 * a stable order between pages — without it, page 2 can repeat or skip a product.
 */
export function buildMarketplaceOrderBy(sort: ProductSort): Record<string, unknown>[] {
  switch (sort) {
    case "PRICE_ASC":
      return [{ priceKobo: "asc" }, { id: "asc" }];
    case "PRICE_DESC":
      return [{ priceKobo: "desc" }, { id: "asc" }];
    case "POPULAR":
      return [{ soldCount: "desc" }, { createdAt: "desc" }, { id: "asc" }];
    case "TOP_RATED":
      // The count breaks ties after the average, so a store with one 5-star
      // rating does not outrank one with forty. Sorting on the stored aggregate
      // is why it is maintained transactionally: an average computed per request
      // over every rating row would not survive a busy evening.
      return [
        { vendorProfile: { ratingAverageHundredths: "desc" } },
        { vendorProfile: { ratingCount: "desc" } },
        { id: "asc" },
      ];
    case "NEWEST":
    default:
      return [{ createdAt: "desc" }, { id: "asc" }];
  }
}

/** Search, filter, sort and paginate the campus catalogue (PRD §24). */
export async function searchProducts(
  actor: Actor,
  query: MarketplaceQueryInput,
): Promise<MarketplacePage> {
  const where = buildMarketplaceWhere(actor, query);
  const orderBy = buildMarketplaceOrderBy(query.sort);

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        name: true,
        slug: true,
        priceKobo: true,
        unitLabel: true,
        stockQuantity: true,
        isAvailable: true,
        soldCount: true,
        category: { select: { id: true, name: true, slug: true } },
        vendorProfile: {
          select: {
            id: true,
            storeName: true,
            slug: true,
            acceptingOrders: true,
            ratingCount: true,
            ratingAverageHundredths: true,
          },
        },
        images: { select: { id: true }, orderBy: { position: "asc" }, take: 1 },
      },
    }),
  ]);

  return {
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    products: rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      priceKobo: row.priceKobo,
      unitLabel: row.unitLabel,
      inStock: row.isAvailable && row.stockQuantity > 0,
      soldCount: row.soldCount,
      imageId: row.images[0]?.id ?? null,
      category: row.category,
      vendor: {
        id: row.vendorProfile.id,
        storeName: row.vendorProfile.storeName,
        slug: row.vendorProfile.slug,
        acceptingOrders: row.vendorProfile.acceptingOrders,
        // Formatted here, once, so every screen shows the same "4.3" and no
        // component has to know that the store is 433 hundredths.
        ratingAverage: formatAverage(
          row.vendorProfile.ratingAverageHundredths,
          row.vendorProfile.ratingCount,
        ),
        ratingCount: row.vendorProfile.ratingCount,
      },
    })),
  };
}

export type MarketplaceProductDetail = MarketplaceProduct & {
  description: string | null;
  imageIds: string[];
  /** Whether the store is open right now, in the campus timezone. */
  vendorIsOpenNow: boolean;
  vendorStorefrontLocation: string;
};

/**
 * One product, for the detail screen.
 *
 * The same campus and approval filters apply, so a product from another campus
 * is "not found" rather than "forbidden" — an id must not be a way to confirm
 * that a record exists elsewhere.
 */
export async function getMarketplaceProduct(
  actor: Actor,
  productId: string,
): Promise<MarketplaceProductDetail> {
  const where = buildMarketplaceWhere(actor, { inStockOnly: false });

  const product = await prisma.product.findFirst({
    where: { ...where, id: productId },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      priceKobo: true,
      unitLabel: true,
      stockQuantity: true,
      isAvailable: true,
      soldCount: true,
      campusId: true,
      category: { select: { id: true, name: true, slug: true } },
      vendorProfile: {
        select: {
          id: true,
          storeName: true,
          slug: true,
          acceptingOrders: true,
          storefrontLocation: true,
          ratingCount: true,
          ratingAverageHundredths: true,
          operatingHours: {
            select: { dayOfWeek: true, isClosed: true, opensAt: true, closesAt: true },
          },
        },
      },
      images: { select: { id: true }, orderBy: { position: "asc" } },
    },
  });
  if (!product) throw new NotFoundError("Product not found");

  assertSameCampus(actor, product.campusId);

  const campus = await prisma.campus.findUnique({
    where: { id: product.campusId },
    select: { timezone: true },
  });

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    priceKobo: product.priceKobo,
    unitLabel: product.unitLabel,
    inStock: product.isAvailable && product.stockQuantity > 0,
    soldCount: product.soldCount,
    imageId: product.images[0]?.id ?? null,
    imageIds: product.images.map((image) => image.id),
    category: product.category,
    vendor: {
      id: product.vendorProfile.id,
      storeName: product.vendorProfile.storeName,
      slug: product.vendorProfile.slug,
      acceptingOrders: product.vendorProfile.acceptingOrders,
      ratingAverage: formatAverage(
        product.vendorProfile.ratingAverageHundredths,
        product.vendorProfile.ratingCount,
      ),
      ratingCount: product.vendorProfile.ratingCount,
    },
    vendorStorefrontLocation: product.vendorProfile.storefrontLocation,
    vendorIsOpenNow:
      product.vendorProfile.acceptingOrders &&
      isWithinOperatingHours(
        product.vendorProfile.operatingHours,
        new Date(),
        campus?.timezone ?? "Africa/Lagos",
      ),
  };
}
