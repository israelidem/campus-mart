import type { UserRole, VerificationStatus } from "@/lib/generated/prisma/enums";

/**
 * The navigation model (pure).
 *
 * Until now every role folder carried its own hardcoded list of links, which is
 * why the student shell shipped with none at all: a verified student could not
 * reach the marketplace without typing the URL. One module now decides what a
 * given person can see, so a new destination is added in one place and cannot be
 * added to four shells and forgotten in the fifth.
 *
 * This is *navigation*, not authorization. It decides what is worth offering;
 * every page still resolves the actor server-side and turns the wrong role away
 * (Rule 29). The two are deliberately separate, and this module is the weaker of
 * the pair — it must never be the only thing standing between a student and an
 * admin screen.
 *
 * The rule the whole module obeys: **never offer a destination that will turn the
 * person away.** A link that answers "you cannot be here" is worse than no link,
 * because the reader cannot tell whether they are forbidden or the app is broken.
 * That is why an unverified student is offered verification instead of a cart the
 * checkout would refuse.
 */

/** What the current person can actually do, resolved from the database. */
export type Capabilities = {
  role: UserRole;
  /** Verified student on an active campus: the gate for buying anything. */
  isVerifiedStudent: boolean;
  /** `NO_APPLICATION` is distinct from `REJECTED`: one invites, one explains. */
  vendorStatus: VerificationStatus | "NO_APPLICATION";
  agentStatus: VerificationStatus | "NO_APPLICATION";
  /** Lines in the cart, for the badge. Never a price — a count is not money. */
  cartCount: number;
};

export type NavItem = {
  href: string;
  label: string;
  /** Long enough to disambiguate two similar destinations in the account menu. */
  hint?: string;
  /** Rendered as a count bubble. Omitted, not zeroed, when there is nothing. */
  badge?: number;
};

export type Navigation = {
  /** Thumb-reachable on a phone. Hard-capped, see PRIMARY_LIMIT. */
  primary: NavItem[];
  /** Everything else, grouped, in the account menu. */
  groups: { title: string; items: NavItem[] }[];
};

/**
 * A bottom bar is a row of thumb targets, not a menu. Five 44px targets is what
 * fits a 320px phone without shrinking them below the size the rest of the app
 * commits to, so the sixth item belongs in the account menu rather than making
 * every target harder to hit.
 */
export const PRIMARY_LIMIT = 5;

const SHOP: NavItem = {
  href: "/marketplace",
  label: "Marketplace",
  hint: "Browse approved stores on your campus",
};

const ORDERS: NavItem = { href: "/orders", label: "Orders", hint: "Your invoices and deliveries" };

const GET_VERIFIED: NavItem = {
  href: "/student/onboarding",
  label: "Get verified",
  hint: "Submit your matric number and ID to start shopping",
};

/*
 * Admin destinations are named rather than reached by index. The four that
 * appear in the bottom bar are referenced by name below, so reordering this list
 * changes the menu order and nothing else — indexing would have let a reorder
 * silently swap which screens a Campus Admin gets one tap away.
 */
const ADMIN_ANALYTICS: NavItem = {
  href: "/admin/analytics",
  label: "Analytics",
  hint: "Revenue, volume and standings",
};
const ADMIN_STUDENTS: NavItem = {
  href: "/admin/students",
  label: "Students",
  hint: "Verify registrations",
};
const ADMIN_VENDORS: NavItem = {
  href: "/admin/vendors",
  label: "Vendors",
  hint: "Review store applications",
};
const ADMIN_DISPUTES: NavItem = {
  href: "/admin/disputes",
  label: "Disputes",
  hint: "Decide refunds",
};

const ADMIN_ITEMS: NavItem[] = [
  ADMIN_ANALYTICS,
  ADMIN_STUDENTS,
  ADMIN_VENDORS,
  { href: "/admin/agents", label: "Agents", hint: "Review and escalate couriers" },
  ADMIN_DISPUTES,
  { href: "/admin/ratings", label: "Reviews", hint: "Moderate ratings" },
  {
    href: "/admin/delivery-locations",
    label: "Delivery locations",
    hint: "Destinations students can choose",
  },
  { href: "/admin/settings", label: "Campus settings", hint: "Commission and delivery fee" },
];

/** True when the person may buy. Kept as one predicate so the rule has one home. */
function canShop(caps: Capabilities): boolean {
  return caps.isVerifiedStudent;
}

/**
 * Selling and delivering are things a *student* opts into, so both are offered to
 * anyone who can shop — that is the PRD's student-vendor model (§20), not an
 * accident. An approved seller is sent to the work; everyone else to the
 * application, labelled as an application so the destination is not a surprise.
 */
function sellingItem(caps: Capabilities): NavItem {
  if (caps.vendorStatus === "APPROVED") {
    return { href: "/vendor/orders", label: "Selling", hint: "Incoming orders for your store" };
  }
  if (caps.vendorStatus === "PENDING_VERIFICATION") {
    return { href: "/vendor/store", label: "Selling", hint: "Your application is under review" };
  }
  if (caps.vendorStatus === "REJECTED" || caps.vendorStatus === "SUSPENDED") {
    return { href: "/vendor/store", label: "Selling", hint: "Your store needs attention" };
  }
  return { href: "/vendor/store", label: "Sell", hint: "Apply to open a store" };
}

function deliveringItem(caps: Capabilities): NavItem {
  if (caps.agentStatus === "APPROVED") {
    return { href: "/agent", label: "Deliveries", hint: "Claim parcels and run hand-overs" };
  }
  if (caps.agentStatus === "PENDING_VERIFICATION") {
    return { href: "/agent", label: "Delivering", hint: "Your application is under review" };
  }
  return { href: "/agent", label: "Deliver", hint: "Apply to carry parcels between lectures" };
}

/** The cart, with a badge only when it holds something. */
function cartItem(caps: Capabilities): NavItem {
  const item: NavItem = { href: "/cart", label: "Cart", hint: "Review and check out" };
  // A zero badge is visual noise that says nothing; absence already says empty.
  return caps.cartCount > 0 ? { ...item, badge: caps.cartCount } : item;
}

/**
 * Builds the navigation for one person.
 *
 * Roles are additive on purpose. A Campus Admin is also a person who may have a
 * cart, and a vendor is a student who sells; collapsing each account to a single
 * role is what produced five shells that each hid most of the app.
 */
export function buildNavigation(caps: Capabilities): Navigation {
  const primary: NavItem[] = [];
  const groups: Navigation["groups"] = [];

  const isAdmin = caps.role === "CAMPUS_ADMIN" || caps.role === "SUPER_ADMIN";

  // Administration leads for an admin: it is the job they signed in to do.
  if (isAdmin) {
    if (caps.role === "SUPER_ADMIN") {
      primary.push({
        href: "/super-admin/campuses",
        label: "Campuses",
        hint: "Create campuses and assign admins",
      });
    }
    primary.push(ADMIN_ANALYTICS, ADMIN_STUDENTS, ADMIN_VENDORS, ADMIN_DISPUTES);
    groups.push({ title: "Administration", items: ADMIN_ITEMS });
  }

  if (canShop(caps)) {
    // An admin's own shopping is real but secondary; a student's is the point.
    if (isAdmin) {
      groups.push({ title: "Shopping", items: [SHOP, cartItem(caps), ORDERS] });
    } else {
      primary.push(SHOP, cartItem(caps), ORDERS);

      const selling = sellingItem(caps);
      const delivering = deliveringItem(caps);
      primary.push(selling, delivering);
      groups.push({ title: "Earning", items: [selling, delivering] });
    }
  } else if (!isAdmin) {
    // Not verified: one honest destination, plus the marketplace to look around.
    primary.push(GET_VERIFIED, SHOP);
  }

  groups.push({
    title: "Account",
    items: [
      { href: "/notifications", label: "Notifications", hint: "Everything you have been told" },
      ...(caps.role === "STUDENT" || caps.isVerifiedStudent
        ? [{ href: "/student/onboarding", label: "Verification", hint: "Your student status" }]
        : []),
    ],
  });

  return { primary: primary.slice(0, PRIMARY_LIMIT), groups };
}

/**
 * Where a person should land after signing in.
 *
 * Shared by the post-sign-in router and the home page so the two can never
 * disagree about where "home" is. It returns the first primary destination,
 * which is why `buildNavigation` puts the most important thing first.
 */
export function homeHref(caps: Capabilities): string {
  const nav = buildNavigation(caps);
  return nav.primary[0]?.href ?? "/notifications";
}

/**
 * Whether `href` is the section the reader is currently in.
 *
 * Prefix matching, so `/marketplace/abc123` still lights up "Marketplace", but
 * anchored at a segment boundary: without that, `/admin/settings` would also
 * match a hypothetical `/admin/settings-archive`. `/` is special-cased because
 * every path is prefixed by it.
 */
export function isActiveHref(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
