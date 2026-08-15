import { describe, expect, it } from "vitest";

import { buildCartView } from "@/lib/orders/cart-view";

import {
  cartItemAddSchema,
  cartItemUpdateSchema,
  checkoutSchema,
  vendorOrderStatusUpdateSchema,
} from "@/validations/order";

/**
 * The cart view is what the student reads before committing money, so the two
 * things tested here are the ones that would cost someone: the arithmetic, and
 * whether a line that can no longer be bought still blocks checkout.
 */

type Row = Parameters<typeof buildCartView>[1][number];

function line(overrides: {
  id: string;
  quantity: number;
  priceKobo: number;
  storeName: string;
  vendorProfileId: string;
  stockQuantity?: number;
  isAvailable?: boolean;
  deletedAt?: Date | null;
  vendorStatus?: string;
  acceptingOrders?: boolean;
}): Row {
  return {
    id: overrides.id,
    quantity: overrides.quantity,
    productId: `product-${overrides.id}`,
    product: {
      name: `Product ${overrides.id}`,
      unitLabel: null,
      priceKobo: overrides.priceKobo,
      stockQuantity: overrides.stockQuantity ?? 10,
      isAvailable: overrides.isAvailable ?? true,
      deletedAt: overrides.deletedAt ?? null,
      vendorProfileId: overrides.vendorProfileId,
      vendorProfile: {
        storeName: overrides.storeName,
        status: overrides.vendorStatus ?? "APPROVED",
        acceptingOrders: overrides.acceptingOrders ?? true,
      },
    },
  };
}

describe("buildCartView", () => {
  it("is empty, and not checkout-ready, when there is no cart", () => {
    const view = buildCartView(null, []);

    expect(view.itemCount).toBe(0);
    expect(view.goodsSubtotalKobo).toBe(0);
    expect(view.isCheckoutReady).toBe(false);
  });

  it("groups lines by store and totals each group in whole kobo", () => {
    const view = buildCartView("cart-1", [
      line({ id: "a", quantity: 2, priceKobo: 150_000, storeName: "Mama Put", vendorProfileId: "v1" }),
      line({ id: "b", quantity: 1, priceKobo: 50_000, storeName: "Mama Put", vendorProfileId: "v1" }),
      line({ id: "c", quantity: 3, priceKobo: 20_000, storeName: "Campus Books", vendorProfileId: "v2" }),
    ]);

    expect(view.vendors).toHaveLength(2);
    // Sorted by store name, so the order does not shift between reads.
    expect(view.vendors.map((vendor) => vendor.storeName)).toEqual(["Campus Books", "Mama Put"]);

    const mamaPut = view.vendors.find((vendor) => vendor.vendorProfileId === "v1");
    expect(mamaPut?.goodsSubtotalKobo).toBe(350_000);

    expect(view.itemCount).toBe(6);
    expect(view.goodsSubtotalKobo).toBe(410_000);
    expect(view.isCheckoutReady).toBe(true);
  });

  it("prices each line from the product, not from anything the client sent", () => {
    const view = buildCartView("cart-1", [
      line({ id: "a", quantity: 3, priceKobo: 99_900, storeName: "Store", vendorProfileId: "v1" }),
    ]);

    const item = view.vendors[0]?.items[0];
    expect(item?.unitPriceKobo).toBe(99_900);
    expect(item?.lineTotalKobo).toBe(299_700);
  });

  it("keeps an unbuyable line visible, explains it, and blocks checkout", () => {
    const cases: Array<[Partial<Parameters<typeof line>[0]>, RegExp]> = [
      [{ deletedAt: new Date() }, /no longer sold/i],
      [{ vendorStatus: "SUSPENDED" }, /not currently active/i],
      [{ acceptingOrders: false }, /not accepting orders/i],
      [{ isAvailable: false }, /unavailable/i],
      [{ stockQuantity: 0 }, /out of stock/i],
      [{ quantity: 5, stockQuantity: 2 }, /only 2 left/i],
    ];

    for (const [overrides, expected] of cases) {
      const view = buildCartView("cart-1", [
        line({
          id: "a",
          quantity: 1,
          priceKobo: 10_000,
          storeName: "Store",
          vendorProfileId: "v1",
          ...overrides,
        }),
      ]);

      const item = view.vendors[0]?.items[0];
      expect(item?.isOrderable).toBe(false);
      expect(item?.unorderableReason).toMatch(expected);

      expect(view.isCheckoutReady).toBe(false);
    }
  });

  it("still totals an unbuyable line, so the student sees what is at stake", () => {
    const view = buildCartView("cart-1", [
      line({
        id: "a",
        quantity: 2,
        priceKobo: 10_000,
        storeName: "Store",
        vendorProfileId: "v1",
        isAvailable: false,
      }),
    ]);

    expect(view.goodsSubtotalKobo).toBe(20_000);
  });
});

describe("order validation", () => {
  it("defaults an add to a single unit and rejects fractions or zero", () => {
    expect(cartItemAddSchema.parse({ productId: "p1" }).quantity).toBeUndefined();
    expect(cartItemAddSchema.safeParse({ productId: "p1", quantity: 0 }).success).toBe(false);
    expect(cartItemAddSchema.safeParse({ productId: "p1", quantity: 1.5 }).success).toBe(false);
    expect(cartItemAddSchema.safeParse({ productId: "", quantity: 1 }).success).toBe(false);
  });

  it("treats a quantity update as absolute and requires at least one unit", () => {
    expect(cartItemUpdateSchema.parse({ quantity: 4 }).quantity).toBe(4);
    // Removing a line is a DELETE, not a zero quantity.
    expect(cartItemUpdateSchema.safeParse({ quantity: 0 }).success).toBe(false);
  });

  it("requires a destination and a reachable phone number at checkout", () => {
    expect(
      checkoutSchema.safeParse({ deliveryLocationId: "loc-1", contactPhone: "08031234567" }).success,
    ).toBe(true);
    expect(checkoutSchema.safeParse({ deliveryLocationId: "", contactPhone: "08031234567" }).success).toBe(
      false,
    );
    expect(
      checkoutSchema.safeParse({ deliveryLocationId: "loc-1", contactPhone: "not-a-number" }).success,
    ).toBe(false);
  });

  it("ignores any price a client tries to state at checkout", () => {
    const parsed = checkoutSchema.parse({
      deliveryLocationId: "loc-1",
      contactPhone: "+2348031234567",
      totalKobo: 1,
      deliveryFeeKobo: 0,
    });

    expect(parsed).not.toHaveProperty("totalKobo");
    expect(parsed).not.toHaveProperty("deliveryFeeKobo");
  });

  it("lets a vendor prepare and mark ready, but not complete a delivery", () => {
    expect(vendorOrderStatusUpdateSchema.safeParse({ status: "PREPARING" }).success).toBe(true);
    expect(vendorOrderStatusUpdateSchema.safeParse({ status: "READY_FOR_PICKUP" }).success).toBe(true);
    // Completion is the delivery engine's to make (Phase 6), not the vendor's.
    expect(vendorOrderStatusUpdateSchema.safeParse({ status: "COMPLETED" }).success).toBe(false);
  });
});
