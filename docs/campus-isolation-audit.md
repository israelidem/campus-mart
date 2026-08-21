# Campus isolation audit

**Phase 13 · PRD Rule 2 ("Campus isolation is absolute")**

Every campus is a separate marketplace. A student at Campus A must not see, order
from, rate, dispute, or even discover anything belonging to Campus B, and no admin of
Campus A may act on Campus B's rows. That guarantee is not a feature of any one
module — it is a property of every query the platform runs, which means it can be
broken by a single new `findMany` that forgets a `where` clause.

This document is the record of walking every data-reading and data-writing path and
naming what enforces the boundary. It exists because "we check the campus" is
untestable as a claim; "these are the 61 places it is checked, and this is the shape
they share" can be reviewed.

## How the boundary is enforced

There are exactly three mechanisms, and every path below uses one of them.

### 1. The actor carries the campus, and the client never states it

`requireActor()` (`lib/auth/session.ts`) resolves a session into an actor whose
`campusId` comes from the **database row**, not from anything the request said. No
route accepts a `campusId` in a body, a query string or a path segment — it is not in
any schema in `validations/`, so there is nothing to trust or distrust. A request
therefore cannot *name* another campus; the worst it can do is name an id belonging
to one.

### 2. Ownership is proved by fetching, not asserted by the client

For a route that acts on a specific row, the row is fetched with its campus in the
`where` clause. This collapses two questions — "does it exist?" and "is it yours?" —
into one query with one answer, and produces `404` for both. The alternative
(`findUnique`, then compare) leaks existence: a `403` tells the caller their guessed
id was real.

```ts
// The shape used throughout, from lib/orders/order-service.ts
const order = await prisma.order.findFirst({
  where: { id: orderId, campusId: actor.campusId, studentId: actor.userId },
});
if (!order) throw new NotFoundError("Order not found");
```

### 3. Admin scope is derived, and the super-admin escape is explicit

`assertCampusScope()` (`lib/authorization/campus.ts`) is the only place a campus other
than the actor's own may be operated on, and it grants that only to
`SUPER_ADMIN`. A `CAMPUS_ADMIN` passing a different `campusId` is refused there,
before any service runs. Cross-campus access is thus a single named function that can
be grepped, not a property of whoever wrote the route.

## The audit

Every row was read against the code as it stands after Phase 13. "Filter" means the
campus appears in the query's `where`; "derived" means the value is taken from the
actor or from an already-scoped parent row rather than from the request.

### Students and onboarding

| Path | Boundary |
| --- | --- |
| `POST /api/students/register` | Campus derived from the email domain via `Campus.emailDomain`; a domain that matches no active campus is refused. The registry check queries `CampusStudentRegistry` filtered by that campus. |
| `GET /api/students/me` | `findFirst` on `userId` + `campusId` from the actor. |
| `PATCH /api/students/profile` | Same, and the update is `updateMany` with the campus in `where`, so a race cannot write another campus's row. |
| `POST /api/students/documents` | Document rows inherit `campusId` from the fetched, scoped profile. |
| `GET/DELETE /api/students/documents/[documentId]` | Document fetched by id **and** `studentProfile.campusId`; a foreign id is a 404. |
| `GET /api/campuses` | Deliberately unfiltered — the sign-up screen must list campuses to pick from. Returns only `id`, `name`, `slug`, `emailDomain` of **active** campuses: no counts, no settings, nothing about anybody's data. |

### Vendors and stores

| Path | Boundary |
| --- | --- |
| `GET/PATCH /api/vendors/me` | Profile fetched by `userId` + actor campus. |
| `PATCH /api/vendors/me/hours`, `/accepting-orders` | Scoped profile fetched first; the update names its id and campus. |
| `POST /api/vendors/documents` | `campusId` inherited from the scoped profile. |
| `GET /api/marketplace/vendors` | `where: { campusId: actor.campusId, status: APPROVED }`. |

### Products and the marketplace

| Path | Boundary |
| --- | --- |
| `GET /api/marketplace/products` | Campus in the `where`, plus `vendorProfile.campusId` on the join, so a product cannot be reached through a foreign store. |
| `POST/PATCH/DELETE /api/products/...` | Product fetched by id + `vendorProfile.userId` + campus. |
| `GET /api/products/images/[imageId]` | Image → product → vendor profile, all three scoped; the served `Content-Type` is re-derived through `safeContentType` (Phase 13). |

### Cart, orders and vendor orders

| Path | Boundary |
| --- | --- |
| `GET/POST/PATCH/DELETE /api/cart...` | Cart is keyed by `studentId` + `campusId`; every added product is re-fetched in the actor's campus, so a foreign product id cannot enter a cart. |
| `POST /api/orders` | Server recomputes every line from scoped product rows and refuses a cart holding anything outside the campus. |
| `GET /api/orders`, `/api/orders/[orderId]` | Campus + `studentId`. |
| `GET /api/vendor-orders`, transitions | `vendorOrder.vendorProfile.userId` + campus. |

### Delivery

| Path | Boundary |
| --- | --- |
| `GET /api/deliveries/available` | Campus + `status: PENDING`; an agent sees only their own campus's queue. |
| `POST /api/deliveries/[id]/accept` | `updateMany` with campus + `status: PENDING` in `where`, which is also what makes acceptance atomic. |
| `POST .../handover-code`, `.../verify-code` | Delivery fetched with campus; the HMAC is over the delivery id, so a code cannot be replayed against another delivery, let alone another campus. Both rate limited (Phase 13). |
| `POST /api/cron/sweep` | Sweeps every campus deliberately — it is the platform's own scheduler, authenticated by `secretsMatch` against `CRON_SECRET`, not by a session. |

### Payments

| Path | Boundary |
| --- | --- |
| `POST /api/payments/delivery-fee`, `/goods` | Delivery/order fetched scoped; amounts recomputed server-side from the campus's own settings. |
| `GET /api/payments/[reference]` | Payment fetched by reference + campus. |
| `POST /api/payments/webhook` | **No actor, by necessity.** Authenticated by HMAC over the raw body; the reference resolves to exactly one `Payment` row, and that row carries its own `campusId`. The webhook therefore cannot be aimed at a campus — it can only settle the one payment it names. Body size capped at 64 KB (Phase 13). |

### Ratings, disputes, notifications

| Path | Boundary |
| --- | --- |
| `POST /api/deliveries/[id]/ratings` | Delivery scoped; subject ids are **resolved from the row**, never accepted from the client. |
| `GET/PATCH/DELETE /api/ratings/...` | Rating fetched by id + campus + author. |
| `POST /api/disputes` | Vendor order fetched scoped; `campusId` inherited from it. |
| `GET /api/disputes/...`, withdraw | Campus + filer. |
| `GET /api/notifications`, mark-read | `userId` + campus. |

### Admin surfaces

Every route under `/api/admin/*` calls `requireActor()` then `assertCampusScope()`,
and passes `actor.campusId` into the service. None accepts a campus from the request.

| Path | Boundary |
| --- | --- |
| `GET /api/admin/students`, `/vendors`, `/ratings`, `/disputes` | Campus in the `where` of the list query and of every count. |
| Review/status transitions | `updateMany` with campus in `where`. |
| `POST /api/admin/students/registry` | Rows written with the admin's own campus; a CSV cannot carry one. |
| `GET/PATCH /api/admin/campus` | Reads and writes the admin's own campus row only. |
| `GET /api/admin/analytics` | Every aggregate — revenue, orders, top stores, agent performance — is filtered by campus. Phase 12's `analytics-policy` takes the campus as a required argument, so an unscoped aggregate does not typecheck. |

### Super-admin surfaces

`/api/super-admin/*` is the intended cross-campus surface: creating campuses,
suspending them, appointing admins. Each route requires `SUPER_ADMIN` explicitly.
This is the one place the boundary is crossed by design, and it is crossed by a role
check rather than by a missing filter.

## What Phase 13 changed

Phase 13 added no new campus filters, because the audit found none missing. What it
added is the enforcement that sits *beside* the boundary:

- **Rate limiting** is keyed by user id and IP, not by campus. Deliberate: a limit
  keyed by campus would let one abusive account consume its whole campus's allowance,
  turning a security control into a denial-of-service against 3,000 students.
- **Uploads** are typed from their bytes, so a file cannot be stored as one thing and
  served as another. Storage keys already contain the campus id; the sniffing change
  means the *contents* can no longer lie about what they are.
- **Private file responses** carry `no-store` and a re-derived content type, so a
  document belonging to one campus cannot be left in a shared cache for another.

## Standing risks

Named rather than left implicit, because an audit that finds nothing is not an audit.

1. **A new query is a new opportunity.** Nothing in the type system forces a campus
   filter. The mitigation is that every service takes `actor` (not ids) as its first
   argument, so writing an unscoped query means ignoring something already in hand.
   `tests/campus-isolation.test.ts` asserts the shape for the paths it covers.
2. **`GET /api/campuses` is public.** It reveals which institutions are on the
   platform. Accepted: that is a marketing fact, and sign-up cannot work without it.
3. **Storage is keyed, not partitioned.** Objects live under
   `campus/<campusId>/...` in one bucket. A misconfigured bucket policy would not
   respect the prefix. Mitigated by never serving storage directly — every byte goes
   through a scoped route.
4. **The webhook is anonymous.** Covered by HMAC and by the fact that a reference
   resolves to one row, but it remains the only mutating path with no actor.
