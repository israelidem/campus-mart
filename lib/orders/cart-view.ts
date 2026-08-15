import { multiplyKobo, sumKobo, type Kobo } from "@/lib/money";

/**
 * Cart presentation logic (PRD §25), kept free of Prisma on purpose.
 *
 * Pricing and buyability are the parts of the cart that can cost a student
 * money, so they live in a pure module that can be unit-tested without a
 * database. `lib/orders/cart-service.ts` supplies the rows.
 */

/** The fields of a cart row this module needs; a subset of the Prisma select. */
export type CartItemRow = {
  id: string;
  quantity: number;
  productId: string;
  product: {
    name: string;
    unitLabel: string | null;
    priceKobo: number;
    stockQuantity: number;
    isAvailable: boolean;
    deletedAt: Date | null;
    vendorProfileId: string;
    vendorProfile: {
      storeName: string;
      status: string;
      acceptingOrders: boolean;
    };
  };
};

export type CartLine = {
  id: string;
  productId: string;
  productName: string;
  unitLabel: string | null;
  unitPriceKobo: Kobo;
  quantity: number;
  lineTotalKobo: Kobo;
  /** Units currently on the shelf, so the UI can cap the stepper. */
  stockQuantity: number;
  vendorProfileId: string;
  storeName: string;
  /**
   * False when the product or its store can no longer be bought from — retired,
   * switched off, out of stock, or the vendor is no longer approved. The line
   * stays visible (and explained) rather than vanishing from the cart.
   */
  isOrderable: boolean;
  unorderableReason: string | null;
};

export type CartVendorGroup = {
  vendorProfileId: string;
  storeName: string;
  items: CartLine[];
  goodsSubtotalKobo: Kobo;
};

export type CartView = {
  cartId: string | null;
  vendors: CartVendorGroup[];
  itemCount: number;
  goodsSubtotalKobo: Kobo;
  /** True when every line is orderable; checkout requires it. */
  isCheckoutReady: boolean;
};

/**
 * Why a line cannot be ordered right now, or null when it can.
 *
 * Ordered from the least recoverable reason to the most, so the student is told
 * the thing they can actually act on.
 */
function unorderableReason(item: CartItemRow): string | null {
  const { product } = item;
  if (product.deletedAt !== null) return "This product is no longer sold";
  if (product.vendorProfile.status !== "APPROVED") return "This store is not currently active";
  if (!product.vendorProfile.acceptingOrders) return "This store is not accepting orders";
  if (!product.isAvailable) return "This product is unavailable";
  if (product.stockQuantity <= 0) return "This product is out of stock";
  if (item.quantity > product.stockQuantity) {
    return `Only ${product.stockQuantity} left in stock`;
  }
  return null;
}

/** Groups lines by store, prices each from the product, and totals the cart. */
export function buildCartView(cartId: string | null, items: CartItemRow[]): CartView {
  const groups = new Map<string, CartVendorGroup>();

  for (const item of items) {
    const { product } = item;
    const lineTotalKobo = multiplyKobo(product.priceKobo, item.quantity);
    const reason = unorderableReason(item);

    const line: CartLine = {
      id: item.id,
      productId: item.productId,
      productName: product.name,
      unitLabel: product.unitLabel,
      unitPriceKobo: product.priceKobo,
      quantity: item.quantity,
      lineTotalKobo,
      stockQuantity: product.stockQuantity,
      vendorProfileId: product.vendorProfileId,
      storeName: product.vendorProfile.storeName,
      isOrderable: reason === null,
      unorderableReason: reason,
    };

    const group = groups.get(line.vendorProfileId) ?? {
      vendorProfileId: line.vendorProfileId,
      storeName: line.storeName,
      items: [],
      goodsSubtotalKobo: 0,
    };
    group.items.push(line);
    group.goodsSubtotalKobo += lineTotalKobo;
    groups.set(line.vendorProfileId, group);
  }

  // Sorted by store name so the cart does not reshuffle between reads.
  const vendors = [...groups.values()].sort((a, b) => a.storeName.localeCompare(b.storeName));
  const lines = vendors.flatMap((vendor) => vendor.items);

  return {
    cartId,
    vendors,
    itemCount: lines.reduce((total, line) => total + line.quantity, 0),
    goodsSubtotalKobo: sumKobo(lines.map((line) => line.lineTotalKobo)),
    isCheckoutReady: lines.length > 0 && lines.every((line) => line.isOrderable),
  };
}
