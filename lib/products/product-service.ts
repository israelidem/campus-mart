import { AuditAction, recordAudit } from "@/lib/audit/audit-log";
import type { Actor } from "@/lib/auth/session";
import { assertSameCampus } from "@/lib/authorization/campus";
import { prisma } from "@/lib/db/prisma";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  StateConflictError,
  ValidationError,
} from "@/lib/errors";
import type { InventoryReason } from "@/lib/generated/prisma/enums";
import { logger } from "@/lib/logger";
import { assertKobo } from "@/lib/money";
import { assertCategoryOnCampus } from "@/lib/products/category-service";
import { slugify } from "@/lib/slug";
import { assertValidDocument, getDocumentStorage } from "@/lib/storage/storage";
import { requireApprovedVendor } from "@/lib/vendors/vendor-service";
import type {
  InventoryAdjustmentInput,
  ProductCreateInput,
  ProductUpdateInput,
} from "@/validations/product";

/**
 * Products and inventory (PRD §21–22, Phase 4).
 *
 * Everything here is gated by `requireApprovedVendor`: a pending, rejected or
 * suspended store has no catalogue. Price is integer kobo and stock only ever
 * moves through `adjustInventory`, which writes an `InventoryTransaction` in the
 * same transaction as the stock change, so the ledger cannot drift from the
 * level it explains.
 */

/** Product photographs only — a PDF is not a product image. */
export const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_IMAGES_PER_PRODUCT = 5;

export type VendorProductView = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  priceKobo: number;
  stockQuantity: number;
  lowStockThreshold: number;
  unitLabel: string | null;
  isAvailable: boolean;
  isLowStock: boolean;
  soldCount: number;
  deletedAt: Date | null;
  category: { id: string; name: string } | null;
  images: { id: string; position: number }[];
  createdAt: Date;
};

const VENDOR_PRODUCT_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  priceKobo: true,
  stockQuantity: true,
  lowStockThreshold: true,
  unitLabel: true,
  isAvailable: true,
  soldCount: true,
  deletedAt: true,
  createdAt: true,
  category: { select: { id: true, name: true } },
  images: { select: { id: true, position: true }, orderBy: { position: "asc" } },
} as const;

type VendorProductRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  priceKobo: number;
  stockQuantity: number;
  lowStockThreshold: number;
  unitLabel: string | null;
  isAvailable: boolean;
  soldCount: number;
  deletedAt: Date | null;
  createdAt: Date;
  category: { id: string; name: string } | null;
  images: { id: string; position: number }[];
};

function toVendorProductView(row: VendorProductRow): VendorProductView {
  return {
    ...row,
    isLowStock: row.stockQuantity <= row.lowStockThreshold,
  };
}

/**
 * Applies a stock movement in memory and rejects impossible results (PRD §22).
 *
 * Kept pure and exported so the rule is unit-testable and identical wherever it
 * is applied; the database still enforces it independently through the guarded
 * conditional update in `adjustInventory`.
 */
export function resolveStockChange(currentStock: number, delta: number): number {
  if (!Number.isInteger(currentStock) || currentStock < 0) {
    throw new ValidationError("Stock level is invalid");
  }
  if (!Number.isInteger(delta) || delta === 0) {
    throw new ValidationError("Enter how many units to add or remove");
  }

  const next = currentStock + delta;
  if (next < 0) {
    throw new StateConflictError(
      `Only ${currentStock} in stock, so ${Math.abs(delta)} cannot be removed`,
    );
  }
  return next;
}

/** The vendor's own catalogue, including paused and retired products. */
export async function listVendorProducts(
  actor: Actor,
  options?: { includeDeleted?: boolean },
): Promise<VendorProductView[]> {
  const vendor = await requireApprovedVendor(actor);

  const products = await prisma.product.findMany({
    where: {
      vendorProfileId: vendor.id,
      campusId: vendor.campusId,
      ...(options?.includeDeleted ? {} : { deletedAt: null }),
    },
    orderBy: { createdAt: "desc" },
    select: VENDOR_PRODUCT_SELECT,
  });

  return products.map(toVendorProductView);
}

/** Loads one of the vendor's own products, or throws. */
async function requireOwnProduct(
  actor: Actor,
  productId: string,
): Promise<{ vendorId: string; campusId: string; product: VendorProductRow }> {
  const vendor = await requireApprovedVendor(actor);

  const product = await prisma.product.findFirst({
    where: { id: productId, vendorProfileId: vendor.id, campusId: vendor.campusId },
    select: VENDOR_PRODUCT_SELECT,
  });
  // Deliberately "not found" rather than "forbidden": another store's product
  // must not be distinguishable from one that does not exist.
  if (!product) throw new NotFoundError("Product not found");

  return { vendorId: vendor.id, campusId: vendor.campusId, product };
}

export async function getVendorProduct(
  actor: Actor,
  productId: string,
): Promise<VendorProductView> {
  const { product } = await requireOwnProduct(actor, productId);
  return toVendorProductView(product);
}

/**
 * Creates a product for the signed-in vendor's store (PRD §21).
 *
 * Opening stock is not written as a bare column value: it is applied as a
 * RESTOCK movement in the same transaction, so even the first unit of stock has
 * a record explaining where it came from.
 */
export async function createProduct(
  actor: Actor,
  input: ProductCreateInput,
): Promise<VendorProductView> {
  const vendor = await requireApprovedVendor(actor);

  assertKobo(input.priceKobo, "priceKobo");

  if (input.categoryId) await assertCategoryOnCampus(input.categoryId, vendor.campusId);

  const slug = slugify(input.name);
  if (slug.length < 2) throw new ValidationError("Product name must contain letters or numbers");

  const clash = await prisma.product.findFirst({
    where: { vendorProfileId: vendor.id, slug },
    select: { id: true },
  });
  if (clash) throw new ConflictError("Your store already has a product with that name");

  const created = await prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        campusId: vendor.campusId,
        vendorProfileId: vendor.id,
        categoryId: input.categoryId ?? null,
        name: input.name,
        slug,
        description: input.description ?? null,
        priceKobo: input.priceKobo,
        stockQuantity: input.stockQuantity,
        lowStockThreshold: input.lowStockThreshold,
        unitLabel: input.unitLabel ?? null,
        isAvailable: input.isAvailable,
      },
      select: VENDOR_PRODUCT_SELECT,
    });

    if (input.stockQuantity > 0) {
      await tx.inventoryTransaction.create({
        data: {
          productId: product.id,
          campusId: vendor.campusId,
          vendorProfileId: vendor.id,
          reason: "RESTOCK",
          delta: input.stockQuantity,
          resultingStock: input.stockQuantity,
          note: "Opening stock",
          actorId: actor.userId,
        },
      });
    }

    await recordAudit(
      {
        action: AuditAction.PRODUCT_CREATED,
        entityType: "Product",
        entityId: product.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId: vendor.campusId,
        after: {
          name: product.name,
          priceKobo: product.priceKobo,
          stockQuantity: product.stockQuantity,
        },
      },
      tx,
    );

    return product;
  });

  logger.info("Product created", {
    productId: created.id,
    vendorProfileId: vendor.id,
    campusId: vendor.campusId,
  });

  return toVendorProductView(created);
}

/** Updates the vendor's own product. Stock is not editable here (PRD §22). */
export async function updateProduct(
  actor: Actor,
  productId: string,
  input: ProductUpdateInput,
): Promise<VendorProductView> {
  const { vendorId, campusId, product } = await requireOwnProduct(actor, productId);

  if (product.deletedAt) {
    throw new StateConflictError("This product has been removed and can no longer be edited");
  }

  if (input.categoryId) await assertCategoryOnCampus(input.categoryId, campusId);

  const data: Record<string, unknown> = {};
  if (input.description !== undefined) data.description = input.description;
  if (input.categoryId !== undefined) data.categoryId = input.categoryId;
  if (input.lowStockThreshold !== undefined) data.lowStockThreshold = input.lowStockThreshold;
  if (input.unitLabel !== undefined) data.unitLabel = input.unitLabel;
  if (input.isAvailable !== undefined) data.isAvailable = input.isAvailable;

  if (input.priceKobo !== undefined) {
    assertKobo(input.priceKobo, "priceKobo");
    data.priceKobo = input.priceKobo;
  }

  if (input.name !== undefined) {
    const slug = slugify(input.name);
    if (slug.length < 2) throw new ValidationError("Product name must contain letters or numbers");

    const clash = await prisma.product.findFirst({
      where: { vendorProfileId: vendorId, slug, id: { not: product.id } },
      select: { id: true },
    });
    if (clash) throw new ConflictError("Your store already has a product with that name");

    data.name = input.name;
    data.slug = slug;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.product.update({
      where: { id: product.id },
      data,
      select: VENDOR_PRODUCT_SELECT,
    });

    await recordAudit(
      {
        action: AuditAction.PRODUCT_UPDATED,
        entityType: "Product",
        entityId: product.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId,
        before: {
          name: product.name,
          priceKobo: product.priceKobo,
          isAvailable: product.isAvailable,
        },
        after: data,
      },
      tx,
    );

    return saved;
  });

  return toVendorProductView(updated);
}

/**
 * Retires a product (PRD §21).
 *
 * A soft delete: the row stays so that order history and inventory movements
 * remain readable, but the product leaves the marketplace immediately.
 */
export async function deleteProduct(
  actor: Actor,
  productId: string,
): Promise<{ id: string; deletedAt: Date }> {
  const { campusId, product } = await requireOwnProduct(actor, productId);

  if (product.deletedAt) throw new StateConflictError("This product has already been removed");

  const deletedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: product.id },
      data: { deletedAt, isAvailable: false },
    });

    await recordAudit(
      {
        action: AuditAction.PRODUCT_DELETED,
        entityType: "Product",
        entityId: product.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId,
        before: { isAvailable: product.isAvailable, deletedAt: null },
        after: { isAvailable: false, deletedAt },
      },
      tx,
    );
  });

  return { id: product.id, deletedAt };
}

export type InventoryAdjustmentResult = {
  productId: string;
  stockQuantity: number;
  delta: number;
  reason: InventoryReason;
  isLowStock: boolean;
};

/**
 * Moves stock and records the movement (PRD §22).
 *
 * The decrement is a **conditional update**: the row is only changed when it
 * still holds enough stock, and the update's own count tells us whether we won.
 * That makes the primitive safe under concurrency without a table lock, which is
 * what Phase 5's "two buyers, one unit" test requires. A read-then-write would
 * be a lost-update bug waiting to happen.
 */
export async function adjustInventory(
  actor: Actor,
  productId: string,
  input: InventoryAdjustmentInput,
): Promise<InventoryAdjustmentResult> {
  const { vendorId, campusId, product } = await requireOwnProduct(actor, productId);

  if (product.deletedAt) {
    throw new StateConflictError("This product has been removed");
  }

  // Fails fast with a helpful message; the guarded update below is what actually
  // makes the rule safe.
  resolveStockChange(product.stockQuantity, input.delta);

  return prisma.$transaction(async (tx) => {
    const guarded = await tx.product.updateMany({
      where:
        input.delta < 0
          ? { id: product.id, stockQuantity: { gte: -input.delta } }
          : { id: product.id },
      data: { stockQuantity: { increment: input.delta } },
    });

    if (guarded.count === 0) {
      throw new StateConflictError("There is no longer enough stock for that adjustment");
    }

    const after = await tx.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { stockQuantity: true, lowStockThreshold: true },
    });

    await tx.inventoryTransaction.create({
      data: {
        productId: product.id,
        campusId,
        vendorProfileId: vendorId,
        reason: input.reason,
        delta: input.delta,
        resultingStock: after.stockQuantity,
        note: input.note ?? null,
        actorId: actor.userId,
      },
    });

    await recordAudit(
      {
        action: AuditAction.PRODUCT_STOCK_ADJUSTED,
        entityType: "Product",
        entityId: product.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId,
        before: { stockQuantity: product.stockQuantity },
        after: { stockQuantity: after.stockQuantity, reason: input.reason, delta: input.delta },
      },
      tx,
    );

    return {
      productId: product.id,
      stockQuantity: after.stockQuantity,
      delta: input.delta,
      reason: input.reason,
      isLowStock: after.stockQuantity <= after.lowStockThreshold,
    };
  });
}

/** The movement history for one of the vendor's products. */
export async function listInventoryHistory(
  actor: Actor,
  productId: string,
  options?: { take?: number },
): Promise<
  {
    id: string;
    reason: InventoryReason;
    delta: number;
    resultingStock: number;
    note: string | null;
    createdAt: Date;
  }[]
> {
  const { product } = await requireOwnProduct(actor, productId);

  return prisma.inventoryTransaction.findMany({
    where: { productId: product.id },
    orderBy: { createdAt: "desc" },
    take: Math.min(options?.take ?? 20, 100),
    select: {
      id: true,
      reason: true,
      delta: true,
      resultingStock: true,
      note: true,
      createdAt: true,
    },
  });
}

/** Stores a product photograph and attaches it to the product. */
export async function addProductImage(
  actor: Actor,
  productId: string,
  file: { filename: string; mimeType: string; bytes: Uint8Array },
): Promise<{ id: string; position: number }> {
  const { vendorId, campusId, product } = await requireOwnProduct(actor, productId);

  if (product.deletedAt) throw new StateConflictError("This product has been removed");

  if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.mimeType as (typeof ALLOWED_IMAGE_MIME_TYPES)[number])) {
    throw new ValidationError("Upload a JPEG, PNG or WebP image");
  }
  // Re-uses the shared checks: size limit and magic-byte/content-type match.
  assertValidDocument(file.mimeType, file.bytes);

  const existing = await prisma.productImage.count({ where: { productId: product.id } });
  if (existing >= MAX_IMAGES_PER_PRODUCT) {
    throw new StateConflictError(`A product can have at most ${MAX_IMAGES_PER_PRODUCT} images`);
  }

  const stored = await getDocumentStorage().put({
    prefix: `campus/${campusId}/vendors/${vendorId}/products/${product.id}`,
    filename: file.filename,
    mimeType: file.mimeType,
    bytes: file.bytes,
  });

  const image = await prisma.productImage.create({
    data: {
      productId: product.id,
      campusId,
      storageKey: stored.storageKey,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
      position: existing,
    },
    select: { id: true, position: true },
  });

  await recordAudit({
    action: AuditAction.PRODUCT_IMAGE_ADDED,
    entityType: "Product",
    entityId: product.id,
    actorId: actor.userId,
    actorRole: actor.role,
    campusId,
    after: { imageId: image.id, position: image.position },
  });

  return image;
}

export async function removeProductImage(
  actor: Actor,
  productId: string,
  imageId: string,
): Promise<{ id: string }> {
  const { campusId, product } = await requireOwnProduct(actor, productId);

  const image = await prisma.productImage.findFirst({
    where: { id: imageId, productId: product.id },
    select: { id: true, storageKey: true },
  });
  if (!image) throw new NotFoundError("Image not found");

  await prisma.productImage.delete({ where: { id: image.id } });
  await getDocumentStorage().delete(image.storageKey);

  await recordAudit({
    action: AuditAction.PRODUCT_IMAGE_REMOVED,
    entityType: "Product",
    entityId: product.id,
    actorId: actor.userId,
    actorRole: actor.role,
    campusId,
    before: { imageId: image.id },
  });

  return { id: image.id };
}

/**
 * Streams a product image to a member of the same campus.
 *
 * Product images are stored privately like onboarding documents, so access is
 * brokered here rather than by a public URL: a campus's catalogue is visible to
 * that campus, not to the open internet (Rule 3, PRD §56).
 */
export async function readProductImage(
  actor: Actor,
  imageId: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const image = await prisma.productImage.findUnique({
    where: { id: imageId },
    select: {
      storageKey: true,
      mimeType: true,
      campusId: true,
      product: {
        select: { deletedAt: true, vendorProfile: { select: { userId: true, status: true } } },
      },
    },
  });
  if (!image) throw new NotFoundError("Image not found");

  assertSameCampus(actor, image.campusId);

  const isOwner = image.product.vendorProfile.userId === actor.userId;
  const isAdmin = actor.role === "CAMPUS_ADMIN" || actor.role === "SUPER_ADMIN";
  const isLive = image.product.deletedAt === null && image.product.vendorProfile.status === "APPROVED";

  if (!isLive && !isOwner && !isAdmin) throw new ForbiddenError();

  const object = await getDocumentStorage().get(image.storageKey);
  return { bytes: object.bytes, mimeType: image.mimeType || object.mimeType };
}
