import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/storage/storage", () => ({
  getDocumentStorage: () => ({}),
  assertValidDocument: () => undefined,
}));

import { resolveStockChange } from "@/lib/products/product-service";
import { slugify } from "@/lib/slug";
import {
  inventoryAdjustmentSchema,
  productCreateSchema,
  productUpdateSchema,
} from "@/validations/product";

describe("resolveStockChange (PRD §22)", () => {
  it("adds stock", () => {
    expect(resolveStockChange(4, 6)).toBe(10);
  });

  it("removes stock down to zero", () => {
    expect(resolveStockChange(3, -3)).toBe(0);
  });

  it("refuses to take stock below zero", () => {
    expect(() => resolveStockChange(2, -3)).toThrow(/Only 2 in stock/);
  });

  it("rejects a movement of zero, which would record nothing", () => {
    expect(() => resolveStockChange(5, 0)).toThrow();
  });

  it("rejects fractional units", () => {
    expect(() => resolveStockChange(5, 1.5)).toThrow();
  });
});

describe("product price validation", () => {
  const valid = { name: "Jollof rice", priceKobo: 150_000 };

  it("accepts a whole number of kobo", () => {
    const parsed = productCreateSchema.parse(valid);

    expect(parsed.priceKobo).toBe(150_000);
    // Defaults: nothing in stock, but on sale once stock arrives.
    expect(parsed.stockQuantity).toBe(0);
    expect(parsed.isAvailable).toBe(true);
  });

  it("rejects a fractional price, which would mean fractions of a kobo", () => {
    expect(() => productCreateSchema.parse({ ...valid, priceKobo: 150.5 })).toThrow();
  });

  it("rejects a free or negative price", () => {
    expect(() => productCreateSchema.parse({ ...valid, priceKobo: 0 })).toThrow();
    expect(() => productCreateSchema.parse({ ...valid, priceKobo: -100 })).toThrow();
  });

  it("rejects negative opening stock", () => {
    expect(() => productCreateSchema.parse({ ...valid, stockQuantity: -1 })).toThrow();
  });

  it("normalises whitespace in the product name", () => {
    expect(productCreateSchema.parse({ ...valid, name: "  Jollof   rice  " }).name).toBe(
      "Jollof rice",
    );
  });

  it("does not let a product update set stock directly", () => {
    const parsed = productUpdateSchema.parse({
      priceKobo: 200_000,
      stockQuantity: 999,
    } as Record<string, unknown>);

    expect("stockQuantity" in parsed).toBe(false);
  });

  it("requires at least one field in an update", () => {
    expect(() => productUpdateSchema.parse({})).toThrow();
  });
});

describe("inventory adjustment validation", () => {
  it("accepts a signed delta with a reason", () => {
    expect(inventoryAdjustmentSchema.parse({ reason: "RESTOCK", delta: 12 }).delta).toBe(12);
    expect(inventoryAdjustmentSchema.parse({ reason: "ADJUSTMENT", delta: -2 }).delta).toBe(-2);
  });

  it("rejects a zero delta", () => {
    expect(() => inventoryAdjustmentSchema.parse({ reason: "RESTOCK", delta: 0 })).toThrow();
  });

  it("does not let a vendor record a SALE by hand", () => {
    // Sales are written by the order pipeline in Phase 5, never asserted here.
    expect(() => inventoryAdjustmentSchema.parse({ reason: "SALE", delta: -1 })).toThrow();
  });
});

describe("slugify", () => {
  it("produces a URL-safe slug", () => {
    expect(slugify("Mama Kemi's Jollof (Large)")).toBe("mama-kemi-s-jollof-large");
  });

  it("collapses separators and trims them from the ends", () => {
    expect(slugify("  --Fried  Rice--  ")).toBe("fried-rice");
  });
});
