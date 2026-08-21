import { describe, expect, it } from "vitest";

import {
  buildNavigation,
  homeHref,
  isActiveHref,
  PRIMARY_LIMIT,
  type Capabilities,
} from "@/lib/navigation/navigation";

/**
 * Navigation is the layer that decides what a person is *offered*. These tests
 * exist because the bug they guard against already shipped once: the student
 * shell was rendered with no links at all, so a verified student could not reach
 * the marketplace without typing the URL, and nothing failed.
 */

function caps(overrides: Partial<Capabilities> = {}): Capabilities {
  return {
    role: "STUDENT",
    isVerifiedStudent: true,
    vendorStatus: "NO_APPLICATION",
    agentStatus: "NO_APPLICATION",
    cartCount: 0,
    ...overrides,
  };
}

const hrefs = (c: Capabilities) => buildNavigation(c).primary.map((item) => item.href);

const allHrefs = (c: Capabilities) => {
  const nav = buildNavigation(c);
  return [...nav.primary, ...nav.groups.flatMap((g) => g.items)].map((i) => i.href);
};

describe("buildNavigation", () => {
  it("gives a verified student the marketplace, cart and orders", () => {
    // The regression that started this: a student with no way to shop.
    expect(hrefs(caps())).toEqual(
      expect.arrayContaining(["/marketplace", "/cart", "/orders"]),
    );
  });

  it("never offers an unverified student a cart they cannot check out", () => {
    const nav = hrefs(caps({ isVerifiedStudent: false }));

    expect(nav).not.toContain("/cart");
    expect(nav).not.toContain("/orders");
    // Offered the one thing that will actually move them forward.
    expect(nav[0]).toBe("/student/onboarding");
  });

  it("offers no admin destination to a student", () => {
    // Navigation is not authorization, but it should never dangle a locked door.
    for (const href of allHrefs(caps())) {
      expect(href.startsWith("/admin")).toBe(false);
      expect(href.startsWith("/super-admin")).toBe(false);
    }
  });

  it("keeps the primary bar within the number of thumb targets that fit", () => {
    const crowded = caps({
      role: "SUPER_ADMIN",
      isVerifiedStudent: true,
      vendorStatus: "APPROVED",
      agentStatus: "APPROVED",
      cartCount: 3,
    });

    expect(buildNavigation(crowded).primary.length).toBeLessThanOrEqual(PRIMARY_LIMIT);
  });

  it("sends an approved vendor to their orders, and an applicant to the form", () => {
    const approved = buildNavigation(caps({ vendorStatus: "APPROVED" }));
    expect(approved.primary.map((i) => i.href)).toContain("/vendor/orders");

    const fresh = buildNavigation(caps());
    expect(fresh.primary.map((i) => i.href)).toContain("/vendor/store");
    // The label must not promise a store to someone who has not opened one.
    expect(fresh.primary.find((i) => i.href === "/vendor/store")?.label).toBe("Sell");
  });

  it("badges the cart only when it holds something", () => {
    const empty = buildNavigation(caps({ cartCount: 0 })).primary.find((i) => i.href === "/cart");
    expect(empty?.badge).toBeUndefined();

    const full = buildNavigation(caps({ cartCount: 2 })).primary.find((i) => i.href === "/cart");
    expect(full?.badge).toBe(2);
  });

  it("gives a campus admin their queues, and does not pretend they can shop", () => {
    const nav = buildNavigation(caps({ role: "CAMPUS_ADMIN", isVerifiedStudent: false }));
    const primary = nav.primary.map((i) => i.href);

    expect(primary).toContain("/admin/students");
    expect(primary).toContain("/admin/disputes");
    // An admin account is not a student account; no verification nag.
    expect(primary).not.toContain("/student/onboarding");
  });

  it("only offers campus creation to a super admin", () => {
    expect(allHrefs(caps({ role: "SUPER_ADMIN" }))).toContain("/super-admin/campuses");
    expect(allHrefs(caps({ role: "CAMPUS_ADMIN" }))).not.toContain("/super-admin/campuses");
  });

  it("offers every destination exactly once", () => {
    // A destination in both the bar and its own group would read as two places.
    const nav = buildNavigation(caps({ vendorStatus: "APPROVED", agentStatus: "APPROVED" }));
    const seen = new Set<string>();

    for (const item of nav.primary) {
      expect(seen.has(item.href)).toBe(false);
      seen.add(item.href);
    }
  });
});

describe("homeHref", () => {
  it("lands each role somewhere it can actually work", () => {
    expect(homeHref(caps())).toBe("/marketplace");
    expect(homeHref(caps({ role: "SUPER_ADMIN" }))).toBe("/super-admin/campuses");
    expect(homeHref(caps({ role: "CAMPUS_ADMIN", isVerifiedStudent: false }))).toBe(
      "/admin/analytics",
    );
    // Unverified: the only honest destination is the one that verifies them.
    expect(homeHref(caps({ isVerifiedStudent: false }))).toBe("/student/onboarding");
  });

  it("always resolves to somewhere, even for an account with nothing yet", () => {
    const nowhere = homeHref(caps({ role: "STUDENT", isVerifiedStudent: false }));
    expect(nowhere.startsWith("/")).toBe(true);
  });
});

describe("isActiveHref", () => {
  it("marks the section a nested page belongs to", () => {
    expect(isActiveHref("/marketplace/abc123", "/marketplace")).toBe(true);
    expect(isActiveHref("/orders", "/orders")).toBe(true);
  });

  it("does not match a sibling that merely starts with the same letters", () => {
    // Without the segment boundary this would light up the wrong tab.
    expect(isActiveHref("/admin/settings-archive", "/admin/settings")).toBe(false);
    expect(isActiveHref("/vendor/orders", "/orders")).toBe(false);
  });

  it("treats home as an exact match only", () => {
    expect(isActiveHref("/", "/")).toBe(true);
    expect(isActiveHref("/marketplace", "/")).toBe(false);
  });
});
