# Campus Mart — Handover

Last updated: 2026-08-15. Written so work can continue on a second machine (or by
another developer/agent) without re-reading the whole codebase.

Source of truth for scope: `docs/PRD.docx`. Build order and

non-negotiable business rules come from there. Per-phase detail lives in
`docs/phase-0-report.md` … `docs/phase-3-report.md`.

---

## 1. Current status

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Foundation: Next.js 16 (Turbopack), TypeScript, ESLint, env config, Neon/Postgres, Prisma 7, Better Auth, base UI, error envelope, logging | Done |
| 1 | Auth & user management: registration, email verification, sessions, student onboarding, private document uploads, duplicate protection, student registry CSV import | Done |
| 2 | Campus management: campuses, campus settings, Campus Admin, Super Admin, server-side campus isolation, audit logging | Done |
| 3 | Vendor system: application, storefront/identity uploads, admin review queue, suspend/reinstate, store profile, operating hours, student-vendor toggle, marketplace exposure | Done |
| 4 | Marketplace: categories, products, images, inventory, search/filter/sort | **Next** |
| 5 | Cart & checkout: multi-vendor cart, master invoice, vendor orders, price snapshots, delivery locations, distance + delivery fee | Not started |
| 6 | Delivery engine: pool, atomic assignment, 15-minute pickup rule, destination lock, cancellations, returns | Not started |
| 7 | Delivery OTP & goods-payment unlock, payment timeout | Not started |
| 8 | Paystack: delivery-fee payment, goods payment, splits, commission, webhooks, idempotency, refunds | Not started |
| 9 | Notifications & PWA: manifest, service worker, installability, push | Not started |
| 10 | Ratings | Not started |
| 11 | Disputes & refunds | Not started |
| 12 | Admin analytics | Not started |
| 13–17 | Security hardening, performance, E2E, ABUAD pilot, production launch | Not started |

Verification at handover: `npm run test` → 46 tests / 5 files passing.
`npm run build` → compiles, typechecks and prerenders 35 routes with no errors.

---

## 2. Getting the second machine running

```bash
git clone <this repo>
cd campus-mart
npm install
copy .env.example .env          # Windows;  cp .env.example .env  elsewhere
# fill in the values in section 3
npx prisma migrate deploy       # or: npx prisma migrate dev
npm run dev                     # http://localhost:3000
```

Scripts (`package.json`): `dev`, `build` (runs `prisma generate` first), `start`,
`lint`, `test` (Vitest, run once), `test:watch`.

Notes
- Prisma Client is generated into `lib/generated/prisma`, which is **gitignored**.
  Run `npx prisma generate` (or `npm run build`) after cloning or after any schema
  change, otherwise TypeScript will report that models such as `vendorProfile` do
  not exist on `PrismaClient`.
- Stale route types under `.next/dev/types` can make `npx tsc --noEmit` complain
  about routes that do exist. `npm run build` regenerates them; that is the
  authoritative typecheck.
- If a dev server is already running, Next.js refuses to start a second one on the
  same directory. Reuse the running port or stop the old process.

## 3. Environment variables

`.env` is gitignored; `.env.example` is the checked-in template. Required today:

- `DATABASE_URL` — pooled Neon connection string (runtime).
- `DIRECT_DATABASE_URL` — direct connection string (Prisma Migrate).
- `BETTER_AUTH_SECRET` — 32-byte random value.
- `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` — base URL, no trailing slash.
- `SUPER_ADMIN_EMAILS` — comma-separated. A verified user with a listed email is
  promoted to Super Admin on sign-in. **This is the only way to bootstrap the
  platform owner; there is no UI.**
- `R2_*` — Cloudflare R2 credentials for private document storage. With these
  unset, uploads fall back to local disk, which is fine for development only.
- `LOG_LEVEL`, `DEFAULT_COMMISSION_BPS`, `MAP_PROVIDER`.

Not needed until their phase: `PAYSTACK_*` (Phase 8), `VAPID_*` (Phase 9),
`MAP_PROVIDER_API_KEY` (Phase 5 if a real provider replaces `haversine`).

Both machines must point at the **same** Neon database, or each will need its own
campus/admin seed data.

## 4. Architecture as built

```
app/                 route handlers + pages, grouped by role
  (auth)/            sign-up, sign-in, verify-email
  student/           onboarding
  vendor/            store (apply + manage)
  admin/             students, vendors, settings        (Campus Admin)
  super-admin/       campuses                           (platform owner)
  api/               all mutations; thin wrappers over lib/ services
lib/
  auth/              Better Auth config, session/actor resolution, bootstrap
  authorization/     campus scoping and role checks
  api/               server handler wrapper + browser client (envelope)
  campus/            campus + settings service
  students/          student onboarding, registry CSV
  vendors/           vendor service, operating hours
  audit/             audit log writer
  storage/           private document storage (R2 / local fallback)
  db/, money.ts, errors.ts, logger.ts, env.ts
validations/         Zod schemas (one module per domain)
components/          ui primitives + per-role components
prisma/              schema.prisma + migrations
tests/               Vitest unit tests
docs/                per-phase reports + this handover
```

Conventions that must be preserved
- **Route handlers do no business logic.** They authenticate, validate with Zod,
  call a `lib/*` service, and return `jsonOk`. Services own the rules.
- **The actor is the security boundary.** `requireActor()` / `getActor()` return
  `{ userId, role, campusId }`. Every campus-scoped query filters on
  `actor.campusId`; only a Super Admin may pass an explicit `campusId`.
  Rule 25/29: never filter in the frontend.
- **API envelope:** `{ ok: true, data }` or `{ ok: false, error: { code, message,
  details } }`. Clients branch on `code`, not on message text.
- **Money is integer kobo** via `lib/money.ts`. No floats anywhere near a price.
- **Every privileged action writes an audit log entry** through `lib/audit`.
- **State changes are named operations inside a transaction** that re-read the row
  and assert the current state — never a bare status assignment.

## 5. What Phase 4 should do next

Follow the PRD's per-feature order: schema → migration → service → validation →
authorization → API → UI → tests.

1. Schema: `Category`, `Product`, `InventoryTransaction`. Every one carries
   `campusId`; `Product` also carries `vendorProfileId`. Price as integer kobo.
   Index `(campusId, isAvailable)` and `(vendorProfileId)`.
2. Service (`lib/products/product-service.ts`): create/update/deactivate a
   product, all gated by `requireApprovedVendor` from `lib/vendors/vendor-service`
   — that function already exists and is the single approval gate.
3. Inventory: adjustments must be transactional and recorded as
   `InventoryTransaction` rows. Do not let stock go negative (PRD §22); the
   two-buyers-one-unit race is a Phase 5 acceptance test, so build the primitive
   correctly now.
4. Marketplace read API: search across product name, vendor name and category;
   filter by category/price/rating/availability; sort by popular/rating/price/
   newest; paginate. Always campus-scoped, and only products of `APPROVED`
   vendors.
5. UI: vendor product management under `app/vendor/products`, student browse and
   product detail under `app/marketplace`.
6. Tests: price/stock validation, campus isolation for the marketplace query, and
   the "approved vendors only" filter.

Acceptance (PRD Phase 4): a vendor can create products; a student on the same
campus can find and view them; a student on another campus cannot.

## 6. Known gaps and debts

- Vendor evidence is served by `/api/students/documents/[documentId]`. The
  authorization is correct (owner or same-campus admin) but the path should be
  renamed to `/api/documents/[documentId]`.
- Vendor suspension does not cancel in-flight work — there are no orders yet.
  `requireApprovedVendor` is the hook Phases 5–6 must call.
- Repeated-cancellation suspension (Rule 27) needs the delivery engine (Phase 6).
- Ratings are absent by design until Phase 10; the marketplace exposes no rating
  field yet, so "sort by rating" in Phase 4 will need a placeholder or should be
  deferred to Phase 10.
- No email delivery is configured. Email verification is issued by Better Auth but
  MVP notification channels are in-app and push only (PRD §53); check the server
  log for verification links in development.
- No CI pipeline yet. Before pushing: `npm run test` and `npm run build`.
- Not deployed. Vercel + Neon + R2 wiring is still to be done (Phase 0 left it at
  "deployable", not "deployed").

## 7. Ground rules for whoever continues

From PRD Part X / Part AA, non-negotiable:

1. The server is the source of truth for price, stock, campus, role, commission,
   delivery fee, payment status and order state.
2. Campus isolation is enforced server-side, in the query.
3. Financial operations are idempotent, and money never sits in an internal
   wallet — Paystack holds and settles it.
4. Delivery state changes go through named state-machine operations, never a
   status write.
5. Do not add features outside the PRD. Finish a phase, write its
   `docs/phase-N-report.md`, then start the next one.
