import { describe, expect, it, vi } from "vitest";

// The services under test import the Prisma client, which opens a connection
// pool at module load. These are pure-logic tests, so the client is stubbed.
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/storage/storage", () => ({
  getDocumentStorage: () => ({}),
  assertValidDocument: () => undefined,
}));

import type { Actor } from "@/lib/auth/session";
import {
  buildMarketplaceOrderBy,
  buildMarketplaceWhere,
} from "@/lib/products/marketplace-service";
import { marketplaceQuerySchema, parseMarketplaceQuery } from "@/validations/product";

function actor(overrides: Partial<Actor> & Pick<Actor, "userId" | "role" | "campusId">): Actor {
  return {
    email: `${overrides.userId}@student.abuad.edu.ng`,
    name: "Test User",
    emailVerified: true,
    isSuspended: false,
    ...overrides,
  };
}

const student = actor({ userId: "u1", role: "STUDENT", campusId: "campus-abuad" });
const otherStudent = actor({ userId: "u2", role: "STUDENT", campusId: "campus-unilag" });
const superAdmin = actor({ userId: "u3", role: "SUPER_ADMIN", campusId: null });


const baseQuery = marketplaceQuerySchema.parse({});

describe("buildMarketplaceWhere", () => {
  it("scopes every read to the actor's campus", () => {
    const where = buildMarketplaceWhere(student, baseQuery);

    expect(where.campusId).toBe("campus-abuad");
  });

  it("refuses a request for another campus rather than silently narrowing it", () => {
    // Rule 25: a campus-bound actor asking for another campus is a violation,
    // not a filter to be corrected, so the request fails loudly.
    expect(() =>
      buildMarketplaceWhere(student, { ...baseQuery, campusId: "campus-unilag" }),
    ).toThrow(/another campus/);
  });

  it("accepts the actor's own campus as an explicit parameter", () => {
    const where = buildMarketplaceWhere(student, { ...baseQuery, campusId: "campus-abuad" });

    expect(where.campusId).toBe("campus-abuad");
  });


  it("isolates two students on different campuses", () => {
    expect(buildMarketplaceWhere(student, baseQuery).campusId).not.toBe(
      buildMarketplaceWhere(otherStudent, baseQuery).campusId,
    );
  });

  it("lets a Super Admin target a named campus", () => {
    const where = buildMarketplaceWhere(superAdmin, {
      ...baseQuery,
      campusId: "campus-unilag",
    });

    expect(where.campusId).toBe("campus-unilag");
  });

  it("only ever exposes products of approved vendors", () => {
    for (const actor of [student, otherStudent, superAdmin]) {
      const where = buildMarketplaceWhere(actor, baseQuery);
      expect(where.vendorProfile).toEqual({ status: "APPROVED" });
    }
  });

  it("excludes retired products", () => {
    expect(buildMarketplaceWhere(student, baseQuery).deletedAt).toBeNull();
  });

  it("hides unavailable and out-of-stock products by default", () => {
    const where = buildMarketplaceWhere(student, baseQuery);

    expect(where.isAvailable).toBe(true);
    expect(where.stockQuantity).toEqual({ gt: 0 });
  });

  it("keeps out-of-stock products when the filter is explicitly off", () => {
    const where = buildMarketplaceWhere(student, { ...baseQuery, inStockOnly: false });

    expect(where.isAvailable).toBeUndefined();
    expect(where.stockQuantity).toBeUndefined();
  });

  it("applies a price range in kobo", () => {
    const where = buildMarketplaceWhere(student, {
      ...baseQuery,
      minPriceKobo: 50_000,
      maxPriceKobo: 150_000,
    });

    expect(where.priceKobo).toEqual({ gte: 50_000, lte: 150_000 });
  });

  it("searches product, store and category names", () => {
    const where = buildMarketplaceWhere(student, { ...baseQuery, q: "jollof" });

    expect(where.OR).toEqual([
      { name: { contains: "jollof", mode: "insensitive" } },
      { description: { contains: "jollof", mode: "insensitive" } },
      { vendorProfile: { storeName: { contains: "jollof", mode: "insensitive" } } },
      { category: { name: { contains: "jollof", mode: "insensitive" } } },
    ]);
  });

  it("keeps the approval rule when a rating floor is added", () => {
    // Both constraints have to land in the *same* nested vendorProfile filter.
    // Two separate keys would leave Prisma with only the last one, which would
    // quietly drop "approved stores only" — the more important of the two.
    const where = buildMarketplaceWhere(student, { ...baseQuery, minRating: 4 });

    expect(where.vendorProfile).toEqual({
      status: "APPROVED",
      ratingAverageHundredths: { gte: 400 },
      ratingCount: { gt: 0 },
    });
  });

  it("compares the floor in stored hundredths", () => {
    // "3 stars and up" is >= 300, so a store averaging 2.99 is excluded.
    const where = buildMarketplaceWhere(student, { ...baseQuery, minRating: 3 });

    expect(where.vendorProfile).toMatchObject({ ratingAverageHundredths: { gte: 300 } });
  });

  it("excludes unrated stores from any rating floor, explicitly", () => {
    // An unrated store's average is 0 and would fail the floor anyway; requiring
    // a count states the intent instead of relying on that coincidence.
    const where = buildMarketplaceWhere(student, { ...baseQuery, minRating: 1 });

    expect(where.vendorProfile).toMatchObject({ ratingCount: { gt: 0 } });
  });

  it("does not constrain ratings at all when no floor is asked for", () => {
    // A new store with no ratings must still be findable by default, or the
    // marketplace would be closed to every vendor who has not sold yet.
    const where = buildMarketplaceWhere(student, baseQuery);

    expect(where.vendorProfile).toEqual({ status: "APPROVED" });
  });
});

describe("buildMarketplaceOrderBy", () => {
  it("sorts by price, popularity and recency", () => {
    expect(buildMarketplaceOrderBy("PRICE_ASC")[0]).toEqual({ priceKobo: "asc" });
    expect(buildMarketplaceOrderBy("PRICE_DESC")[0]).toEqual({ priceKobo: "desc" });
    expect(buildMarketplaceOrderBy("POPULAR")[0]).toEqual({ soldCount: "desc" });
    expect(buildMarketplaceOrderBy("NEWEST")[0]).toEqual({ createdAt: "desc" });
  });

  it("sorts by the selling store's average, then by how many rated it", () => {
    // The count is the tie-breaker so one 5-star rating does not outrank forty.
    expect(buildMarketplaceOrderBy("TOP_RATED").slice(0, 2)).toEqual([
      { vendorProfile: { ratingAverageHundredths: "desc" } },
      { vendorProfile: { ratingCount: "desc" } },
    ]);
  });

  it("always breaks ties on id so pages cannot repeat a row", () => {
    for (const sort of ["PRICE_ASC", "PRICE_DESC", "POPULAR", "TOP_RATED", "NEWEST"] as const) {
      const order = buildMarketplaceOrderBy(sort);
      expect(order[order.length - 1]).toEqual({ id: "asc" });
    }
  });
});

describe("parseMarketplaceQuery", () => {
  it("defaults to newest first, page 1, and hiding out-of-stock items", () => {
    const query = parseMarketplaceQuery(new URLSearchParams());

    expect(query.sort).toBe("NEWEST");
    expect(query.page).toBe(1);
    expect(query.pageSize).toBe(20);
    expect(query.inStockOnly).toBeUndefined();
  });

  it("reads inStockOnly=false as false, not as a truthy string", () => {
    const query = parseMarketplaceQuery(new URLSearchParams("inStockOnly=false"));

    expect(query.inStockOnly).toBe(false);
  });

  it("rejects an inverted price range", () => {
    expect(() =>
      parseMarketplaceQuery(new URLSearchParams("minPriceKobo=900&maxPriceKobo=100")),
    ).toThrow();
  });

  it("caps the page size so one request cannot drain the catalogue", () => {
    expect(() => parseMarketplaceQuery(new URLSearchParams("pageSize=500"))).toThrow();
  });

  it("reads a rating floor from the query string", () => {
    expect(parseMarketplaceQuery(new URLSearchParams("minRating=4")).minRating).toBe(4);
  });

  it("applies no rating floor unless one is asked for", () => {
    expect(parseMarketplaceQuery(new URLSearchParams()).minRating).toBeUndefined();
  });

  it("rejects a rating floor outside the five stars", () => {
    // Six stars do not exist, and a half star cannot be a whole-star floor.
    expect(() => parseMarketplaceQuery(new URLSearchParams("minRating=6"))).toThrow();
    expect(() => parseMarketplaceQuery(new URLSearchParams("minRating=0"))).toThrow();
    expect(() => parseMarketplaceQuery(new URLSearchParams("minRating=4.5"))).toThrow();
  });

  it("accepts the top-rated sort", () => {
    expect(parseMarketplaceQuery(new URLSearchParams("sort=TOP_RATED")).sort).toBe("TOP_RATED");
  });
});
