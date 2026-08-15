# Campus Mart — Handover

Last updated: 2026-08-15 (end of Phase 8). Written so work can continue on a


second machine (or by another developer/agent) without re-reading the whole
codebase.


Source of truth for scope: `docs/PRD.docx`. Build order and

non-negotiable business rules come from there. Per-phase detail lives in
`docs/phase-0-report.md` … `docs/phase-8-report.md`.




---

## 1. Current status

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Foundation: Next.js 16 (Turbopack), TypeScript, ESLint, env config, Neon/Postgres, Prisma 7, Better Auth, base UI, error envelope, logging | Done |
| 1 | Auth & user management: registration, email verification, sessions, student onboarding, private document uploads, duplicate protection, student registry CSV import | Done |
| 2 | Campus management: campuses, campus settings, Campus Admin, Super Admin, server-side campus isolation, audit logging | Done |
| 3 | Vendor system: application, storefront/identity uploads, admin review queue, suspend/reinstate, store profile, operating hours, student-vendor toggle, marketplace exposure | Done |
| 4 | Marketplace: categories, products, images, inventory ledger, search/filter/sort | Done |
| 5 | Cart & checkout: multi-vendor cart, master invoice, vendor orders, price snapshots, delivery locations, distance + delivery fee | Done |
| 6 | Delivery engine: agents, pool, atomic assignment, 15-minute pickup rule, destination lock, cancellations, returns | Done |
| 7 | Delivery hand-over code & goods-payment unlock, payment timeout | Done |
| 8 | Paystack: delivery-fee payment, goods payment, splits, commission, webhooks, idempotency, refunds | Done |
| 9 | Notifications & PWA: manifest, service worker, installability, push | **Next** |
| 10 | Ratings | Not started |
| 11 | Disputes & refunds | Not started |
| 12 | Admin analytics | Not started |
| 13–17 | Security hardening, performance, E2E, ABUAD pilot, production launch | Not started |

Verification at handover: `npm run test` → 162 tests / 13 files passing.

`npm run lint` → clean. `npm run build` → compiles and typechecks with no errors
(a full Turbopack production build takes several minutes on a laptop; be patient
rather than assuming it hung).


All migrations are applied to the Neon database (`npx prisma migrate status`


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

- `PAYSTACK_SECRET_KEY` — required for payments (Phase 8). Unset means every
  payment route answers 503 `PAYMENTS_NOT_CONFIGURED`.

Not needed until their phase: `VAPID_*` (Phase 9),
`MAP_PROVIDER_API_KEY` (only if a real routing provider replaces `haversine` in
`lib/delivery/pricing.ts`).

Both machines must point at the **same** Neon database, or each will need its own
campus/admin seed data.

### Deploying (Vercel)

Set at least `DATABASE_URL`, `DIRECT_DATABASE_URL`, `BETTER_AUTH_SECRET` and
`SUPER_ADMIN_EMAILS` in the project's environment variables. Two traps:

- **Do not leave `BETTER_AUTH_URL` (or `NEXT_PUBLIC_APP_URL`) pointing at
  localhost.** Better Auth compares the request's `Origin` against its base URL
  and answers 403 `INVALID_ORIGIN` when they differ, so *every* sign-in fails.
  `lib/auth/origins.ts` now falls back to the Vercel-provided host and trusts the
  deployment's own hostnames, so leaving both unset is safer than setting them
  wrongly; set them explicitly once a custom domain exists.
- **`SUPER_ADMIN_EMAILS` must be set there too.** Without it the allowlist falls
  back to its default and your session resolves as a plain student.

Do not run the seed from a shared environment with `SEED_SUPER_ADMIN_PASSWORD`
left in place; seed once, from a machine you control, against the same database.


## 4. Architecture as built

```
app/                 route handlers + pages, grouped by role
  (auth)/            sign-up, sign-in, verify-email
  student/           onboarding
  vendor/            store (apply + manage), products, orders
  marketplace/       browse + product detail            (students)
  cart/, orders/     cart, checkout, invoices           (students)
  agent/             delivery agent console             (students who deliver)
  admin/             students, vendors, settings, delivery locations, agents

  super-admin/       campuses                           (platform owner)
  api/               all mutations; thin wrappers over lib/ services
lib/
  auth/              Better Auth config, session/actor resolution, bootstrap
  authorization/     campus scoping and role checks
  api/               server handler wrapper + browser client (envelope)
  campus/            campus + settings service
  students/          student onboarding, registry CSV
  vendors/           vendor service, operating hours
  products/          categories, products, inventory, marketplace query
  orders/            cart view + service, order service, delivery locations
  delivery/          pricing, delivery state machine, agents, hand-over codes
  payments/          Paystack boundary, settlement maths, payment service
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

## 5. What Phase 9 should do next

Follow the PRD's per-feature order: schema → migration → service → validation →
authorization → API → UI → tests.

Phase 9 is notifications and the PWA (PRD §51–55). Every event worth telling
someone about already exists and is already written inside a transaction, so the
work is a notification *service* the existing services call — not new business
logic.

1. **Schema**: `Notification` (campus-scoped, per user, read/unread) and
   `PushSubscription` (endpoint + keys per device). MVP channels are in-app and
   push only; there is no email sender.
2. **Service**: one `notify(...)` entry point, called from the named operations
   that already exist — order placed, vendor order accepted, delivery pooled and
   accepted, agent arrived, hand-over verified, payment settled, goods returned.
   Sending must never break the operation that triggered it, the way `recordAudit`
   does not.
3. **Push**: web-push with `VAPID_*`. A subscription that the browser has revoked
   comes back as 404/410 — delete it rather than retrying forever.
4. **PWA**: manifest, service worker, installability. Check the agent console
   works offline enough to be honest about it (read-only, no stale actions).
5. **Two schedulers are overdue and belong here** (see gaps): `expirePickups` and
   `expireGoodsPayments` need Vercel cron entries. A payment window that only
   closes when someone happens to look is not a rule.
6. Tests: notification fan-out per event, a revoked subscription being pruned, and
   that a failed send does not roll back the delivery or payment that caused it.

Acceptance (PRD Phase 9): the app installs on Android, a student receives a push
when an agent arrives, and an agent receives one when a job enters their campus
pool.

### Payments: what a second machine needs to know

- `PAYSTACK_SECRET_KEY` must be set or every payment route answers 503
  `PAYMENTS_NOT_CONFIGURED`. That is deliberate; a deployment without keys should
  refuse rather than pretend.
- The webhook is `POST /api/payments/webhook`, unauthenticated by design and
  protected only by the HMAC signature over the raw body. Point the Paystack
  dashboard at it per environment, and never let a test-mode key and a live-mode
  dashboard meet.
- Locally, Paystack cannot reach `localhost`. Either tunnel (`ngrok`) or rely on
  the callback path: `GET /api/payments/[reference]` re-verifies and applies the
  same effect, so a payment settles without a webhook ever arriving.






## 6. Known gaps and debts

- Vendor evidence is served by `/api/students/documents/[documentId]`. The
  authorization is correct (owner or same-campus admin) but the path should be
  renamed to `/api/documents/[documentId]`.
- Vendor suspension blocks new sales (`requireApprovedVendor` gates cart adds and
  checkout) but does not touch orders already placed, and a suspended store's
  in-flight deliveries stay in the pool. Still undecided.
- Agent suspension is the same shape: an agent suspended mid-trip keeps the
  delivery they are carrying. Cancelling it for them would need the return path,
  which exists (`reportStudentUnavailable`) but is written for an absent student.
- Rule 27 escalates on cancellation count only, and the count never decays. If
  agents are punished for a bad week, give it a window (cancellations in the last
  N days) — the `DeliveryEvent` rows already carry the timestamps to do it.
- `expirePickups` is called opportunistically from `listPool`, so a campus with no
  agents reading the pool never expires anything. Wire it to a scheduler
  (Vercel cron) before the pilot.
- The agent console reflects deadlines only when the page is refreshed; there is
  no live countdown or push. Phase 9 owns that.
- `expireGoodsPayments` has no trigger at all — unlike `expirePickups` there is no
  natural read path to hang it off. It needs the same Vercel cron entry, or an
  unpaid hand-over sits in `PAYMENT_PENDING` until someone tries to pay and is
  told the window closed.
- The hand-over code is shown in the issuing response and never again. There is
  no "resend" that keeps the old code, by design; if a student loses it they must
  issue a new one, which invalidates the previous code.
- Vendor payouts depend on `VendorProfile.paystackSubaccountCode`, and nothing
  creates it — onboarding a vendor to Paystack is a manual dashboard step today. A
  vendor without one still sells; the platform receives the whole amount, the
  payment records `vendorRouted: false`, and a warning is logged. Someone has to
  settle those by hand until vendor onboarding is automated.
- Refunds are full-amount and have no admin UI. `refundPayment` is called
  automatically only when money lands for something already cancelled or returned.
  Partial refunds and a human-initiated path are Phase 11.
- Delivery-agent payouts are out of scope for the MVP: the delivery fee settles to
  the platform account, not to the agent who earned it.


- Ratings are absent by design until Phase 10, so the marketplace has no
  "sort by rating" option and no rating filter. Add both with Phase 10 rather than
  shipping a placeholder.
- Product images are stored privately and streamed by
  `/api/products/images/[imageId]`, which means no CDN caching for listing photos.
  Revisit in Phase 13 (performance) if browse latency matters.
- `soldCount` on `Product` is incremented at checkout and decremented when an
  unpaid order is cancelled, so "most popular" counts placed orders, not delivered
  ones. Revisit if that proves misleading once deliveries exist.
- The delivery fee is `0` when either the campus or the chosen location has no
  coordinates — the fee formula cannot invent a distance. Campus Admins should be
  told to set coordinates before the pilot.

- Marketplace search uses `contains` with `mode: "insensitive"`. Adequate for the
  ABUAD pilot; Phase 13 should consider Postgres full-text search or a trigram
  index if catalogues grow.

- No email delivery is configured. Email verification is issued by Better Auth but
  MVP notification channels are in-app and push only (PRD §53); check the server
  log for verification links in development.
- No CI pipeline yet. Before pushing: `npm run test` and `npm run build`.
- Deployed to Vercel against the same Neon database. R2 is still unset, so
  uploaded documents and product images land on the instance's local disk and do
  not survive a redeploy — wire up `R2_*` before the pilot.
- Sign-in on the deployment failed with 403 `INVALID_ORIGIN` until
  `lib/auth/origins.ts` was introduced; see "Deploying (Vercel)" above. The
  sign-in page now reports the cause instead of blaming the password.


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
