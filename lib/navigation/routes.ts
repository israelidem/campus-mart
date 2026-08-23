import type { UserRole } from "@/lib/generated/prisma/enums";

/**
 * What each destination *requires of the visitor*, as data.
 *
 * This module exists because of a bug that shipped twice, in two different
 * disguises, and could not be caught by any test that existed:
 *
 *  1. An approved vendor signing in was sent to `/student/onboarding`, whose
 *     guard is `role !== "STUDENT" -> /after-sign-in`, whose router sends them
 *     back. The page and the router were each individually correct; together
 *     they were an infinite redirect, and the vendor saw a flickering blank
 *     screen.
 *  2. A Super Admin was offered "Students" and "Vendors", both of which guard on
 *     `role !== "CAMPUS_ADMIN"`, so both bounced to `/after-sign-in` and landed
 *     back on Campuses. The tabs looked broken; in fact they were forbidden.
 *
 * Both have the same shape: **navigation offered a destination that the
 * destination itself refuses.** `navigation.ts` already stated the rule —
 * "never offer a destination that will turn the person away" — but the rule was
 * enforced by hand, in prose, in a file that grew a branch per phase.
 *
 * So the requirement is written down once, next to the path, and
 * `buildNavigation` filters every item through `canReach` before offering it. A
 * link that would bounce is now impossible to offer: it is removed by
 * construction rather than by remembering.
 *
 * This is *not* an authorization boundary and must never be treated as one. Every
 * page still resolves the actor server-side and turns the wrong visitor away
 * (Rule 29). This table only has to agree with those guards; the guards remain
 * the thing that actually protects the data.
 */

/** The conditions a page can place on a visitor. */
export type RouteAccess = {
  /**
   * Roles the page admits. Absent means the page does not discriminate by role,
   * only (possibly) by campus.
   */
  roles?: readonly UserRole[];
  /**
   * True when the page redirects a visitor who has no `campusId`. Every
   * campus-scoped screen does, because a marketplace with no campus has nothing
   * to show — and a Super Admin belongs to no campus, so this is the condition
   * that quietly excludes them.
   */
  campus?: boolean;
};

const ADMINS = ["CAMPUS_ADMIN", "SUPER_ADMIN"] as const;
const CAMPUS_ADMIN_ONLY = ["CAMPUS_ADMIN"] as const;

/**
 * Transcribed from the `redirect` calls in each `page.tsx`, not from intent.
 *
 * Where a guard is looser than it arguably should be, the loose truth is what is
 * recorded, because a table that describes the app we *meant* to write cannot
 * catch a redirect loop in the app we actually shipped.
 */
export const ROUTE_ACCESS: Record<string, RouteAccess> = {
  // Shopping. No role restriction: an admin who is also a verified student may
  // buy lunch. All of it is campus-scoped.
  "/marketplace": { campus: true },
  "/cart": { campus: true },
  "/orders": { campus: true },
  "/store": { campus: true },

  // Anyone signed in, regardless of role or campus.
  "/notifications": {},

  // Student verification. The `STUDENT`-only guard is the whole of bug 1 above:
  // this is the one destination a vendor or agent must never be offered.
  "/student/onboarding": { roles: ["STUDENT"] },

  // Selling. `/vendor/store` explicitly excludes both admin roles; the other two
  // check only for a campus, which is looser than intended but recorded as-is.
  "/vendor": {},
  "/vendor/store": { roles: ["STUDENT", "VENDOR", "DELIVERY_AGENT"], campus: true },
  "/vendor/orders": { campus: true },
  "/vendor/products": { campus: true },

  // Delivering.
  "/agent": {},

  // Campus administration. The split matters: the first three are the campus
  // admin's own queues and reject a Super Admin outright, while the rest accept
  // either. `/admin/delivery-locations` accepts both roles but *also* demands a
  // campus, which excludes a Super Admin by a second route — the third instance
  // of bug 2, and one nobody had reported yet.
  "/admin/students": { roles: CAMPUS_ADMIN_ONLY },
  "/admin/vendors": { roles: CAMPUS_ADMIN_ONLY },
  "/admin/settings": { roles: CAMPUS_ADMIN_ONLY },
  "/admin/analytics": { roles: ADMINS },
  "/admin/disputes": { roles: ADMINS },
  "/admin/agents": { roles: ADMINS },
  "/admin/ratings": { roles: ADMINS },
  "/admin/delivery-locations": { roles: ADMINS, campus: true },

  // Platform administration.
  "/super-admin/campuses": { roles: ["SUPER_ADMIN"] },
};

/**
 * The access rule for a path, matched at segment boundaries.
 *
 * `/orders/abc123` inherits the rule for `/orders`, and the longest match wins so
 * `/vendor/store` is not governed by `/vendor`. An unknown path returns `{}` —
 * "signed in is enough" — which is the honest answer for a table that cannot see
 * routes added after it, and errs toward showing a link rather than hiding a
 * working screen.
 */
export function accessFor(path: string): RouteAccess {
  let best: RouteAccess = {};
  let bestLength = -1;

  for (const [prefix, access] of Object.entries(ROUTE_ACCESS)) {
    const matches = path === prefix || path.startsWith(`${prefix}/`);
    if (matches && prefix.length > bestLength) {
      best = access;
      bestLength = prefix.length;
    }
  }

  return best;
}

/** What `canReach` needs to know. A subset of `Capabilities`, so both can use it. */
export type Visitor = {
  role: UserRole;
  hasCampus: boolean;
};

/**
 * Whether this visitor would be admitted, rather than redirected.
 *
 * Deliberately conservative: it answers "will the page let them in", never
 * "should it". A `false` here means the link must not be drawn.
 */
export function canReach(visitor: Visitor, path: string): boolean {
  const access = accessFor(path);

  if (access.roles && !access.roles.includes(visitor.role)) return false;
  if (access.campus && !visitor.hasCampus) return false;

  return true;
}
