# Campus Mart — Handover

Last updated: 2026-08-15 (end of Phase 4). Written so work can continue on a
second machine (or by another developer/agent) without re-reading the whole
codebase.


Source of truth for scope: `docs/PRD.docx`. Build order and

non-negotiable business rules come from there. Per-phase detail lives in
`docs/phase-0-report.md` … `docs/phase-4-report.md`.


---

## 1. Current status

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Foundation: Next.js 16 (Turbopack), TypeScript, ESLint, env config, Neon/Postgres, Prisma 7, Better Auth, base UI, error envelope, logging | Done |
| 1 | Auth & user management: registration, email verification, sessions, student onboarding, private document uploads, duplicate protection, student registry CSV import | Done |
| 2 | Campus management: campuses, campus settings, Campus Admin, Super Admin, server-side campus isolation, audit logging | Done |
| 3 | Vendor system: application, storefront/identity uploads, admin review queue, suspend/reinstate, store profile, operating hours, student-vendor toggle, marketplace exposure | Done |
| 4 | Marketplace: categories, products, images, inventory ledger, search/filter/sort | Done |
| 5 | Cart & checkout: multi-vendor cart, master invoice, vendor orders, price snapshots, delivery locations, distance + delivery fee | **Next** |

| 6 | Delivery engine: pool, atomic assignment, 15-minute pickup rule, destination lock, cancellations, returns | Not started |
| 7 | Delivery OTP & goods-payment unlock, payment timeout | Not started |
| 8 | Paystack: delivery-fee payment, goods payment, splits, commission, webhooks, idempotency, refunds | Not started |
| 9 | Notifications & PWA: manifest, service worker, installability, push | Not started |
| 10 | Ratings | Not started |
| 11 | Disputes & refunds | Not started |
| 12 | Admin analytics | Not started |
| 13–17 | Security hardening, performance, E2E, ABUAD pilot, production launch | Not started |

Verification at handover: `npm run test` → 80 tests / 7 files passing.
`npm run lint` → clean. `npm run build` → compiles, typechecks and collects 49
routes with no errors.

All three migrations are applied to the Neon database (`npx prisma migrate status`

clean, `prisma migrate diff --from-config-datasource --to-schema` reports no
difference), so a second machine pointed at the same database only needs
`npm install` and `npx prisma generate`.



---

## 2. Getting the second machine running

```bash
git clone <this repo>
cd campus-mart
npm install
copy .env.example .env          # Windows;  cp .env.example .env  elsewhere
# fill in the values in section 3
npx prisma migrate deploy       # or: npx prisma migrate dev
npm run db:seed                 # see "First launch" below — only needed once
npm run dev                     # http://localhost:3000
```

### First launch (bootstrap)

An empty database cannot be entered through the UI, by design:

- Sign-up requires an **active campus**, and the campus dropdown is empty.
- Campuses can only be created by a **Super Admin**.
- Super Admin is granted by `lib/auth/bootstrap.ts` to an email listed in
  `SUPER_ADMIN_EMAILS` — but only once that account's **email is verified**.
- Email delivery is not configured (PRD §53), so the verification link is only
  written to the server log, which is awkward on a deployed instance.

`prisma/seed.ts` breaks that cycle once, for the platform owner only:

1. Creates the owner's account through Better Auth's `signUpEmail`, so the
   password is hashed exactly as a normal sign-up would hash it.
2. Sets `emailVerified` on that one allowlisted address, standing in for the
   verification click.
3. Calls the real `ensureSuperAdmin`, so the promotion is audited like any other.
4. Calls the real `createCampus` as that Super Admin, which also creates the
   campus settings row.

```bash
# .env: SUPER_ADMIN_EMAILS=you@example.com
#       SEED_SUPER_ADMIN_PASSWORD=<strong password, 10+ chars>
npm run db:seed
```

Then sign in at `/sign-in` with that email and password. Re-running the seed is
safe; each step checks for what it would create. Remove
`SEED_SUPER_ADMIN_PASSWORD` from `.env` afterwards.

From there everything is UI work: `/super-admin/campuses` to add campuses and
assign a Campus Admin (the person must already have a verified account), then
students register at `/sign-up`, a Campus Admin verifies them under
`/admin/students`, vendors apply at `/vendor/store` and are approved under
`/admin/vendors`, and approved vendors list products at `/vendor/products`.

Note that a student registering normally still needs their email verified. With
no mail provider, the verification URL appears in the server log
("Email verification requested"); open it manually in development.


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
  vendor/            store (apply + manage), products
  marketplace/       browse + product detail            (students)

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

## 5. What Phase 5 should do next

Follow the PRD's per-feature order: schema → migration → service → validation →
authorization → API → UI → tests.

1. Schema: `Cart`/`CartItem`, `Order` (the master invoice), `VendorOrder`,
   `OrderItem`, `DeliveryLocation`. Every one carries `campusId`. Order items must
   **snapshot** `unitPriceKobo` and the product name at checkout — later price
   edits must not change a placed order.
2. Cart: one cart per student per campus, items from several vendors allowed. The
   cart is split into one `VendorOrder` per vendor at checkout, under a single
   master invoice.
3. Reservation: at checkout, decrement stock through the Phase 4 primitive
   `adjustInventory` (reason `SALE`) inside the same transaction as the order
   write. `resolveStockChange` plus the `Product_stockQuantity_nonnegative`
   constraint are what make the "two buyers, one unit" acceptance test pass — do
   not bypass them with a bare `update`.
4. Delivery fee: computed server-side only, from campus settings and the distance
   between the store and the delivery location (`MAP_PROVIDER=haversine` for now).
   Integer kobo, via `lib/money.ts`.
5. UI: cart and checkout for students; incoming orders for vendors.
6. Tests: price snapshot immutability, per-vendor split, fee computation, and
   stock never going negative under concurrent checkout.

Acceptance (PRD Phase 5): a student can check out a multi-vendor cart and get one
invoice with one delivery fee and correct per-vendor totals; a second buyer cannot
take stock that no longer exists.


## 6. Known gaps and debts

- Vendor evidence is served by `/api/students/documents/[documentId]`. The
  authorization is correct (owner or same-campus admin) but the path should be
  renamed to `/api/documents/[documentId]`.
- Vendor suspension does not cancel in-flight work — there are no orders yet.
  `requireApprovedVendor` is the hook Phases 5–6 must call.
- Repeated-cancellation suspension (Rule 27) needs the delivery engine (Phase 6).
- Ratings are absent by design until Phase 10, so the marketplace has no
  "sort by rating" option and no rating filter. Add both with Phase 10 rather than
  shipping a placeholder.
- Product images are stored privately and streamed by
  `/api/products/images/[imageId]`, which means no CDN caching for listing photos.
  Revisit in Phase 13 (performance) if browse latency matters.
- `soldCount` on `Product` powers "most popular" but nothing increments it yet;
  Phase 5's checkout must, in the same transaction as the `SALE` ledger row.
- Marketplace search uses `contains` with `mode: "insensitive"`. Adequate for the
  ABUAD pilot; Phase 13 should consider Postgres full-text search or a trigram
  index if catalogues grow.

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
