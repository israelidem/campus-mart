import type { Actor } from "@/lib/auth/session";
import { prisma, type PrismaTransactionClient } from "@/lib/db/prisma";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { buildCartView, type CartItemRow, type CartView } from "@/lib/orders/cart-view";
import type { CartItemAddInput, CartItemUpdateInput } from "@/validations/order";

/**
 * Multi-vendor cart (PRD §25).
 *
 * The cart stores nothing but product references and quantities. Prices, line
 * totals and the subtotal are recomputed from `Product` on every read by
 * `lib/orders/cart-view`, so a price change between browsing and checkout is
 * always reflected, and a client can never dictate what something costs (Rule 1).
 *
 * Items from several vendors sit in one cart; the split into vendor orders
 * happens at checkout (PRD §27).
 */

export type { CartLine, CartVendorGroup, CartView } from "@/lib/orders/cart-view";

/**
 * Only an approved student of the campus may hold a cart (PRD §14).
 *
 * The check is a query rather than a claim on the session: verification status
 * can change after sign-in, and a suspended or pending student must not be able
 * to transact.
 */
export async function requireVerifiedStudent(
  actor: Actor,
): Promise<{ studentProfileId: string; campusId: string }> {
  if (actor.role !== "STUDENT") {
    throw new ForbiddenError("Only a student can shop on the marketplace");
  }
  if (!actor.campusId) {
    throw new ForbiddenError("Your account is not attached to a campus");
  }

  const profile = await prisma.studentProfile.findUnique({
    where: { userId: actor.userId },
    select: { id: true, campusId: true, status: true },
  });

  if (!profile || profile.status !== "APPROVED") {
    throw new ForbiddenError("Your student verification must be approved before you can order");
  }
  if (profile.campusId !== actor.campusId) {
    throw new ForbiddenError("Your student profile belongs to another campus");
  }

  return { studentProfileId: profile.id, campusId: profile.campusId };
}

/**
 * The row shape every cart read needs: the line, its product, and just enough of
 * the store to decide whether the line can still be ordered.
 */
const cartItemSelect = {
  id: true,
  quantity: true,
  productId: true,
  product: {
    select: {
      id: true,
      name: true,
      unitLabel: true,
      priceKobo: true,
      stockQuantity: true,
      isAvailable: true,
      deletedAt: true,
      vendorProfileId: true,
      vendorProfile: {
        select: { id: true, storeName: true, status: true, acceptingOrders: true },
      },
    },
  },
} as const;

/** The student's cart on their campus, priced from the current product rows. */
export async function getCart(actor: Actor): Promise<CartView> {
  const { campusId } = await requireVerifiedStudent(actor);

  const cart = await prisma.cart.findUnique({
    where: { studentId_campusId: { studentId: actor.userId, campusId } },
    select: { id: true, items: { select: cartItemSelect, orderBy: { createdAt: "asc" } } },
  });

  if (!cart) return buildCartView(null, []);
  return buildCartView(cart.id, cart.items as unknown as CartItemRow[]);
}

/**
 * Loads a product a student is allowed to buy, on their own campus only.
 *
 * The campus filter is in the query (Rule 25): a product id from another campus
 * must read as "not found", not as a permission error, so ids cannot be probed.
 */
async function loadOrderableProduct(
  tx: PrismaTransactionClient,
  productId: string,
  campusId: string,
) {
  const product = await tx.product.findFirst({
    where: { id: productId, campusId, deletedAt: null },
    select: {
      id: true,
      stockQuantity: true,
      isAvailable: true,
      vendorProfile: { select: { status: true, acceptingOrders: true } },
    },
  });

  if (!product) throw new NotFoundError("Product not found");
  if (product.vendorProfile.status !== "APPROVED") {
    throw new ValidationError("This store is not currently active");
  }
  if (!product.vendorProfile.acceptingOrders) {
    throw new ValidationError("This store is not accepting orders");
  }
  if (!product.isAvailable) throw new ValidationError("This product is unavailable");

  return product;
}

/** The message a student should see when they ask for more than exists. */
function stockShortfall(stockQuantity: number): string {
  return stockQuantity === 0
    ? "This product is out of stock"
    : `Only ${stockQuantity} left in stock`;
}

/**
 * Adds a product, or raises the quantity of a line that already exists.
 *
 * Adding the same product twice must not create a second line, so the write is
 * an upsert on `(cartId, productId)` — the database's unique index, not a prior
 * read, is what guarantees it.
 */
export async function addToCart(actor: Actor, input: CartItemAddInput): Promise<CartView> {
  const { campusId } = await requireVerifiedStudent(actor);
  const requested = input.quantity ?? 1;

  await prisma.$transaction(async (tx) => {
    const product = await loadOrderableProduct(tx, input.productId, campusId);

    const cart = await tx.cart.upsert({
      where: { studentId_campusId: { studentId: actor.userId, campusId } },
      create: { studentId: actor.userId, campusId },
      update: {},
      select: { id: true },
    });

    const existing = await tx.cartItem.findUnique({
      where: { cartId_productId: { cartId: cart.id, productId: product.id } },
      select: { quantity: true },
    });

    const quantity = (existing?.quantity ?? 0) + requested;
    if (quantity > product.stockQuantity) {
      throw new ValidationError(stockShortfall(product.stockQuantity));
    }

    await tx.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId: product.id } },
      create: { cartId: cart.id, campusId, productId: product.id, quantity },
      update: { quantity },
    });
  });

  return getCart(actor);
}

/** Sets a line to an absolute quantity. */
export async function updateCartItem(
  actor: Actor,
  cartItemId: string,
  input: CartItemUpdateInput,
): Promise<CartView> {
  const { campusId } = await requireVerifiedStudent(actor);

  await prisma.$transaction(async (tx) => {
    const item = await tx.cartItem.findFirst({
      where: { id: cartItemId, campusId, cart: { studentId: actor.userId } },
      select: { id: true, productId: true },
    });
    if (!item) throw new NotFoundError("Cart item not found");

    const product = await loadOrderableProduct(tx, item.productId, campusId);
    if (input.quantity > product.stockQuantity) {
      throw new ValidationError(stockShortfall(product.stockQuantity));
    }

    await tx.cartItem.update({ where: { id: item.id }, data: { quantity: input.quantity } });
  });

  return getCart(actor);
}

export async function removeCartItem(actor: Actor, cartItemId: string): Promise<CartView> {
  const { campusId } = await requireVerifiedStudent(actor);

  const item = await prisma.cartItem.findFirst({
    where: { id: cartItemId, campusId, cart: { studentId: actor.userId } },
    select: { id: true },
  });
  if (!item) throw new NotFoundError("Cart item not found");

  await prisma.cartItem.delete({ where: { id: item.id } });
  return getCart(actor);
}

export async function clearCart(actor: Actor): Promise<CartView> {
  const { campusId } = await requireVerifiedStudent(actor);

  await prisma.cartItem.deleteMany({
    where: { campusId, cart: { studentId: actor.userId } },
  });

  return getCart(actor);
}
