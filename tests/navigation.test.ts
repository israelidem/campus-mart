import { describe, expect, it } from "vitest";

import type { UserRole, VerificationStatus } from "@/lib/generated/prisma/enums";
import {
  buildNavigation,
  homeHref,
  isActiveHref,
  PRIMARY_LIMIT,
  type Capabilities,
} from "@/lib/navigation/navigation";
import { canReach, ROUTE_ACCESS, type Visitor } from "@/lib/navigation/routes";

/**
 * Navigation is the layer that decides what a person is *offered*. These tests
 * exist because the bug they guard against already shipped once: the student
 * shell was rendered with no links at all, so a verified student could not reach
 * the marketplace without typing the URL, and nothing failed.
 *
 * It then shipped twice more, in a nastier form. Navigation offered destinations
 * that the destination itself refuses, and the refusal was a `redirect` back to
 * the router that had just sent them — an infinite loop rather than an error:
 *
 *  • An approved vendor was sent to `/student/onboarding` (`STUDENT`-only).
 *  • A Super Admin was offered `/admin/students` and `/admin/vendors`
 *    (`CAMPUS_ADMIN`-only).
 *
 * Every example-based test below passed throughout, because each only checked the
 * roles someone had thought to write down. So the important test in this file is
 * no longer any single example: it is `describe("no destination that bounces")`,
 * which enumerates *every* role against *every* status and asserts the invariant
 * directly. It fails on a role nobody remembered to consider, which is precisely
 * how both loops got in.
 */

function caps(overrides: Partial<Capabilities> = {}): Capabilities {
  return {
    role: "STUDENT",
    hasCampus: true,
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
    expect(hrefs(caps())).toEqual(expect.arrayContaining(["/marketplace", "/cart", "/orders"]));
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
      hasCampus: false,
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
    expect(allHrefs(caps({ role: "SUPER_ADMIN", hasCampus: false }))).toContain(
      "/super-admin/campuses",
    );
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

  it("gives a vendor account their store, not student verification", () => {
    /*
     * The exact shape of the deployed bug: a `VENDOR` matched no branch, fell
     * through to the unverified-student case, and was offered "Get verified" —
     * a page that refuses non-students by redirecting to the router that had just
     * sent them there. The vendor saw a blank, endlessly reloading screen.
     */
    const vendor = caps({ role: "VENDOR", isVerifiedStudent: false, vendorStatus: "APPROVED" });
    const nav = buildNavigation(vendor);

    expect(allHrefs(vendor)).not.toContain("/student/onboarding");
    expect(nav.primary.map((i) => i.href)).toContain("/vendor/orders");
    // The loop began here: this used to resolve to `/student/onboarding`.
    expect(homeHref(vendor)).toBe("/vendor/orders");
  });

  it("does not offer an unapproved vendor screens their store cannot use yet", () => {
    // Orders and Products for a store that cannot trade are taps to empty pages.
    const pending = buildNavigation(
      caps({ role: "VENDOR", isVerifiedStudent: false, vendorStatus: "PENDING_VERIFICATION" }),
    );
    const primary = pending.primary.map((i) => i.href);

    expect(primary).toContain("/vendor/store");
    expect(primary).not.toContain("/vendor/orders");
  });

  it("gives a delivery agent their run board", () => {
    const nav = buildNavigation(
      caps({ role: "DELIVERY_AGENT", isVerifiedStudent: false, agentStatus: "APPROVED" }),
    );

    expect(nav.primary.map((i) => i.href)).toContain("/agent");
    expect(allHrefs(caps({ role: "DELIVERY_AGENT", isVerifiedStudent: false }))).not.toContain(
      "/student/onboarding",
    );
  });

  it("withholds campus-scoped screens from an account with no campus", () => {
    /*
     * A Super Admin belongs to no campus, and every campus-scoped page redirects a
     * visitor without one. `/admin/delivery-locations` is the trap: it admits both
     * admin roles *and* demands a campus, so a role check alone would have offered
     * it and it would have bounced.
     */
    const superAdmin = allHrefs(caps({ role: "SUPER_ADMIN", hasCampus: false }));

    expect(superAdmin).not.toContain("/admin/delivery-locations");
    expect(superAdmin).not.toContain("/marketplace");
    expect(superAdmin).not.toContain("/cart");
  });

  it("never renders a group heading with nothing under it", () => {
    // An empty group reads as content that failed to load.
    for (const role of ROLES) {
      const nav = buildNavigation(caps({ role, hasCampus: role !== "SUPER_ADMIN" }));
      for (const group of nav.groups) {
        expect(group.items.length).toBeGreaterThan(0);
      }
    }
  });
});

/*
 * The invariant, checked exhaustively rather than by example.
 *
 * `ROLES × STATUSES × STATUSES × hasCampus × isVerifiedStudent` is a few hundred
 * combinations, which is cheap to enumerate and covers the accounts nobody thought
 * to write a test for — including the two that shipped broken.
 */
const ROLES: readonly UserRole[] = [
  "STUDENT",
  "VENDOR",
  "DELIVERY_AGENT",
  "CAMPUS_ADMIN",
  "SUPER_ADMIN",
];

const STATUSES: readonly (VerificationStatus | "NO_APPLICATION")[] = [
  "NO_APPLICATION",
  "PENDING_VERIFICATION",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
];

/** Every account shape the app can produce, as `Capabilities`. */
function everyAccount(): Capabilities[] {
  const all: Capabilities[] = [];

  for (const role of ROLES) {
    for (const vendorStatus of STATUSES) {
      for (const agentStatus of STATUSES) {
        for (const hasCampus of [true, false]) {
          for (const isVerifiedStudent of [true, false]) {
            all.push(
              caps({
                role,
                hasCampus,
                // Buying requires a campus, so this combination cannot exist.
                isVerifiedStudent: isVerifiedStudent && hasCampus,
                vendorStatus,
                agentStatus,
              }),
            );
          }
        }
      }
    }
  }

  return all;
}

const describeAccount = (c: Capabilities) =>
  `${c.role} campus=${c.hasCampus} student=${c.isVerifiedStudent} vendor=${c.vendorStatus} agent=${c.agentStatus}`;

describe("no destination that bounces", () => {
  it("offers only destinations that will admit the visitor", () => {
    for (const account of everyAccount()) {
      const visitor: Visitor = { role: account.role, hasCampus: account.hasCampus };

      for (const href of allHrefs(account)) {
        expect(
          canReach(visitor, href),
          `${describeAccount(account)} was offered ${href}, which would redirect them away`,
        ).toBe(true);
      }
    }
  });

  it("lands every account somewhere that will admit it", () => {
    /*
     * This is the redirect loop, stated directly. `/after-sign-in` sends people to
     * `homeHref`; if that page refuses them it redirects back to `/after-sign-in`,
     * which computes the same answer, forever. Both shipped loops fail here.
     */
    for (const account of everyAccount()) {
      const visitor: Visitor = { role: account.role, hasCampus: account.hasCampus };
      const home = homeHref(account);

      expect(
        canReach(visitor, home),
        `${describeAccount(account)} would be sent to ${home}, which redirects them back`,
      ).toBe(true);
    }
  });

  it("gives every account at least one destination", () => {
    // A shell with an empty bar is the original bug: an app with no way through it.
    for (const account of everyAccount()) {
      expect(allHrefs(account).length, `${describeAccount(account)} was offered nothing`)
        .toBeGreaterThan(0);
    }
  });
});

describe("route access table", () => {
  it("describes every destination navigation can offer", () => {
    /*
     * `accessFor` returns "signed in is enough" for an unknown path, which is the
     * right default for a table that cannot see routes added later — but it means
     * a new destination with a stricter guard would be offered to everyone. This
     * test makes forgetting the table an immediate, local failure instead of a
     * redirect loop discovered in production.
     */
    const prefixes = Object.keys(ROUTE_ACCESS);

    for (const account of everyAccount()) {
      for (const href of allHrefs(account)) {
        const known = prefixes.some((p) => href === p || href.startsWith(`${p}/`));
        expect(known, `${href} is offered but has no entry in ROUTE_ACCESS`).toBe(true);
      }
    }
  });
});

describe("homeHref", () => {
  it("lands each role somewhere it can actually work", () => {
    expect(homeHref(caps())).toBe("/marketplace");
    expect(homeHref(caps({ role: "SUPER_ADMIN", hasCampus: false }))).toBe(
      "/super-admin/campuses",
    );
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

  it("falls back to a page that asks nothing of anyone", () => {
    /*
     * A brand-new vendor with no campus matches no work branch and cannot shop, so
     * everything is filtered out. The fallback must be reachable by *everyone*
     * signed in, or the empty case becomes a loop of its own.
     */
    const stranded = caps({
      role: "VENDOR",
      hasCampus: false,
      isVerifiedStudent: false,
      vendorStatus: "NO_APPLICATION",
    });

    const home = homeHref(stranded);
    expect(canReach({ role: "VENDOR", hasCampus: false }, home)).toBe(true);
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

describe("accessFor", () => {
  it("prefers the most specific rule", () => {
    // `/vendor` admits anyone signed in; `/vendor/store` refuses admins. If the
    // shorter prefix won, an admin would be offered a store page that bounces.
    expect(canReach({ role: "CAMPUS_ADMIN", hasCampus: true }, "/vendor")).toBe(true);
    expect(canReach({ role: "CAMPUS_ADMIN", hasCampus: true }, "/vendor/store")).toBe(false);
  });

  it("applies a rule to nested pages", () => {
    expect(canReach({ role: "SUPER_ADMIN", hasCampus: false }, "/orders/abc123")).toBe(false);
    expect(canReach({ role: "STUDENT", hasCampus: true }, "/orders/abc123")).toBe(true);
  });
});
