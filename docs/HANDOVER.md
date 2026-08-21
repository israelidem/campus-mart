# Campus Mart — Handover

Last updated: 2026-08-21 (Phases 0–12 done). Written so work can continue on a
second machine (or by another developer/agent) without re-reading the whole
codebase.

Source of truth for scope: `docs/PRD.docx`. Build order and
non-negotiable business rules come from there. Per-phase detail lives in
`docs/phase-0-report.md` … `docs/phase-12-report.md`.





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
| 9 | Notifications & PWA: notification catalogue, in-app inbox, web push, manifest, service worker, offline page, installability | Done |
| 10 | Ratings: per-delivery vendor + agent ratings, 24-hour edit window, admin moderation, stored aggregates, marketplace "top rated" sort and rating filter | Done |
| 11 | Disputes & refunds: 7-day window, one live case per vendor order, partial refunds, payout-first attribution, admin queue | Done |
| 12 | Admin analytics: campus dashboard, revenue/commission, order volume, delivery medians, dispute rate, vendor/product/location/agent standings | Done |
| 13 | Security hardening | **Next** |
| 14–17 | Performance, E2E, ABUAD pilot, production launch | Not started |

Verification at handover: `npm run test` → 279 tests / 17 files passing.
`npm run lint` → clean. `npm run build` → compiles and typechecks with no errors
(a full Turbopack production build takes several minutes on a laptop; be patient
rather than assuming it hung).

All migrations are applied to the Neon database (`npx prisma migrate status`
clean, `prisma migrate diff --from-config-datasource --to-schema` reports no
difference), so a second machine pointed at the same database only needs
`npm install` and `npx prisma generate`.

**Run `npx prisma generate` before you trust a typecheck.** A stale generated
client typechecks against last week's schema. That is not hypothetical: it hid
four notification types with no renderer through the whole of Phase 10, and they
would have shipped as blank messages. See `docs/phase-11-report.md`.



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

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — web push
  (Phase 9). Generate with `npx web-push generate-vapid-keys`. Optional: with them
  unset the app logs once and runs with in-app notifications only.
- `CRON_SECRET` — bearer token for `/api/cron/sweep`. Unset means the sweep
  refuses every request rather than running unauthenticated.

Not needed until their phase: `MAP_PROVIDER_API_KEY` (only if a real routing
provider replaces `haversine` in `lib/delivery/pricing.ts`).


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
  notifications/     in-app inbox
  admin/             students, vendors, settings, delivery locations, agents,
                     ratings, disputes, analytics
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
  notifications/     copy catalogue, notify(), web push
  ratings/           rating policy (pure) + rating service
  disputes/          dispute policy (pure) + dispute/refund service
  analytics/         analytics policy (pure) + dashboard aggregation
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

## 5. What Phase 13 should do next

Follow the PRD's per-feature order: schema → migration → service → validation →
authorization → API → UI → tests.

Phase 13 is security hardening. Unlike Phase 12, which read what was already
there, this phase mostly *removes* — it closes the doors the previous twelve
phases left open because closing them early would have slowed the build. It adds
almost no user-visible surface, which makes it the easiest phase to declare done
without having done it. Do not.

The list below is not invented; every item is a debt named in section 6 or a rule
in Part X that has no enforcement point yet.

1. **Rate limiting on the routes that cost money or leak facts.** Sign-in and
   sign-up (credential stuffing), `POST /api/students/register`, hand-over code
   issuing and verification (a six-digit code is brute-forceable in minutes at
   unlimited rate — this is the single most urgent item on the list), and every
   payment initiation. Per-user *and* per-IP, since one attacker with one account
   and one student behind a shared campus NAT are different problems.
2. **Verification attempt limits on the hand-over code specifically.** Rate
   limiting slows a brute force; a lockout after N wrong codes stops it. The
   `DeliveryEvent` rows already record every attempt.
3. **Security headers.** CSP, `Strict-Transport-Security`, `X-Content-Type-Options`,
   `Referrer-Policy`, `Permissions-Policy`, in `next.config.ts`. Expect the CSP to
   be the slow one: Paystack's inline checkout and the service worker both need
   deliberate allowances, and a CSP that breaks payments is worse than none.
4. **An upload allowlist that reads the bytes, not the filename.** `lib/storage`
   accepts what it is handed. Check the magic number, cap the size, and never
   serve an uploaded file with a `Content-Type` taken from the request.
5. **Audit the audit log.** Rule: every privileged action writes one. Verify that
   is actually true for all of Phases 8–12 — refunds, dispute resolutions, agent
   escalations — rather than assuming it.
6. **Webhook hardening.** The Paystack HMAC check exists; add replay protection
   (reject an event id already processed) and confirm the raw body is used before
   any parsing middleware can touch it.
7. **A written campus-isolation audit.** Grep every `prisma.*.findMany` and prove
   each one either filters on `actor.campusId` or is deliberately global. This is
   mechanical, boring, and the single highest-value hour in the phase.
8. **Session hardening**: cookie flags, absolute session lifetime, and revoking
   sessions on a role change. A user demoted from Campus Admin must not keep
   admin access until their cookie expires.
9. **Tests**: rate-limiter policy (window arithmetic, per-key isolation), the
   upload sniffing, and the header presence. All pure or near-pure.

Two traps worth naming in advance:

- **A rate limiter in module scope does not work on serverless.** Each Vercel
  instance gets its own `Map`, so ten instances mean ten times the limit. Either
  accept that explicitly and document it, or back it with Postgres/Upstash. Do not
  ship an in-memory limiter while believing it enforces a global limit.
- **Do not let hardening change a business rule by accident.** If a limit makes a
  legitimate flow fail — a student legitimately re-issuing a hand-over code — that
  is a bug in the limit, not an acceptable cost.

Acceptance (PRD Phase 13): the platform withstands the obvious attacks —
credential stuffing, code brute-forcing, replayed webhooks, malicious uploads,
cross-campus reads — and every privileged action leaves a trail.

### Analytics: what a second machine needs to know

- **`lib/analytics/analytics-policy.ts` is pure**: ranges, rates, medians,
  comparisons and formatting. The clock is a parameter. Every rate returns `null`
  for an empty denominator, and the UI renders `null` as "—" plus a sentence.
  **Never render a missing metric as zero**; a campus with no deliveries does not
  have a 0% success rate.
- **Aggregate in Postgres.** The only two exceptions are the medians and the daily
  series, which Prisma cannot express; both read a narrow projection and the
  median reads are capped with `take`.
- **Each `where` is typed against its own model** (`scopeVendorOrder`,
  `scopeDelivery`, …) rather than one generic helper. A generic helper over
  `Record<string, unknown>` compiles with a misspelt field, and a reporting bug
  that returns plausible numbers is the hardest kind to notice.
- **Revenue counts `COMPLETED` vendor orders; volume counts placed orders.** A
  cancelled order is demand that happened and money that did not.
- **Delivery fees come from `Payment` filtered on `paidAt`**, not from the order.
  A fee is revenue when it was captured, in the period it was captured.
- **Refunds net against the platform's share only** — the figure Phase 11's
  `attributeRefund` produced. `netPlatformKobo` may therefore be negative, which is
  why it is a plain `number` and printed by a local `formatSignedKobo` rather than
  by weakening `formatKobo` for every caller.
- **The query range is half-open and the displayed end is not the query end.** The
  internal bound is the start of the day after `to`; a millisecond is subtracted
  for display only. Never feed the display value back into arithmetic.
- **The range is capped at 366 days in validation** because the daily series
  allocates one bucket per day. If a campus outgrows that, add a nightly rollup
  table — do not raise the cap.


### Disputes: what a second machine needs to know

- **`lib/disputes/dispute-policy.ts` is pure and owns every money decision.** The
  clock is always a parameter. Do not compute a refund amount or an attribution
  anywhere else.
- **A dispute hangs off a `VendorOrder`, never an `Order`.** An invoice can span two
  stores; a complaint is against one of them.
- **The snapshot on the `Dispute` row is the ceiling, not the live order.** The
  goods subtotal, commission and payout are copied onto the row when the case is
  filed, so a later commission change cannot retroactively alter an old refund.
- **A refund comes out of the payout first, and the commission only after.**
  `attributeRefund` gives the vendor's payout to the refund up to its own size and
  charges the platform only the excess. Splitting proportionally would have the
  platform funding a refund for goods it never touched.
- **A partial refund is capped at the goods subtotal, not the order total.** The
  delivery fee belongs to the agent who earned it.
- **Write the `Refund` row before calling Paystack**, so a provider timeout leaves
  a record to reconcile rather than silent money movement. The `CHECK` constraints
  are the backstop if that ordering is ever got wrong.
- **One live dispute per vendor order**, enforced by a partial unique index. The
  service checks first for a readable error; the index is what makes the check
  true. A *resolved* case does not block a new one.
- **Resolution answers 200 even when the provider refuses the refund**, carrying
  `refund.succeeded` and `refund.failureReason`. The decision happened and is
  recorded; what failed is the money movement, and the admin needs to be told that
  precisely rather than shown a generic error.


### Ratings: what a second machine needs to know

- **`lib/ratings/rating-policy.ts` is pure and is the source of truth** for scores,
  the 24-hour edit window and every aggregate transition. The clock is always a
  parameter, never `new Date()` inside the module — that is what makes the window
  testable at the millisecond boundary.
- **Aggregates are `count` + `sum`, with the average derived.** Never write
  `ratingAverageHundredths` from anything but `applyNewRating` /
  `applyEditedRating` / `applyRemovedRating` / `applyRestoredRating`, and never
  outside the transaction that writes the rating row. A rating and the average it
  produced must not be able to disagree.
- **An edit moves the sum, not the count.** If you see the count change on an edit,
  that is the bug.
- **Only `COMPLETED` deliveries are rateable.** `RETURNED` and `CANCELLED` are
  Phase 11's territory.
- **`formatAverage` returns `null` for an unrated subject**, and the UI must render
  "No ratings yet" rather than "0.0". A new store has no reputation; that is not
  the same as a bad one.
- **The marketplace rating floor and the approval rule share one nested
  `vendorProfile` filter.** Adding a second `vendorProfile` key would silently drop
  "approved stores only". There is a test guarding it; do not remove it.

### Notifications: what a second machine needs to know

- **All copy lives in `lib/notifications/messages.ts`** as pure functions. Change
  wording there, not in a component. The `Record<NotificationType, …>` means a new
  enum value without copy is a compile error, which is intentional.
- **`notify()` is called from services, never from route handlers**, so an event
  triggered by cron notifies exactly like one triggered by a request.
- **A push must never fail an operation.** The row is the record; the push is a
  copy. `sendPush` never throws.
- **Push is optional.** No VAPID keys means in-app only, logged once at startup.
- **The bell polls once a minute** and pauses while the tab is hidden. This is a
  deliberate choice over websockets: the news arrives in minutes, and a campus on
  patchy 3G keeps a poll but loses a socket.
- **`/api/cron/sweep`** now runs `expirePickups` and `expireGoodsPayments` and
  prunes read notifications. It needs a Vercel cron entry plus `CRON_SECRET`;
  without the schedule the timeout rules are still only enforced opportunistically.


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
- `expirePickups` and `expireGoodsPayments` are now both called by
  `/api/cron/sweep`, but **nothing schedules it yet**. Add the Vercel cron entry
  and `CRON_SECRET` before the pilot; until then `expirePickups` still only runs
  opportunistically from `listPool` (so a campus with no agents reading the pool
  expires nothing) and an unpaid hand-over sits in `PAYMENT_PENDING` until someone
  tries to pay.
- The agent console still has no live countdown; deadlines update on refresh or on
  the notification bell's poll. Push covers arrival and hand-over, which is the
  part that mattered.

- The hand-over code is shown in the issuing response and never again. There is
  no "resend" that keeps the old code, by design; if a student loses it they must
  issue a new one, which invalidates the previous code.
- Vendor payouts depend on `VendorProfile.paystackSubaccountCode`, and nothing
  creates it — onboarding a vendor to Paystack is a manual dashboard step today. A
  vendor without one still sells; the platform receives the whole amount, the
  payment records `vendorRouted: false`, and a warning is logged. Someone has to
  settle those by hand until vendor onboarding is automated.
- **A refund that Paystack refuses is recorded but not retried.** The `Refund` row
  exists with its failure reason, the dispute is resolved, and the admin is told —
  but nothing sweeps failed refunds and tries again. Until something does, an admin
  who sees "the refund needs retrying" has to resolve it through the Paystack
  dashboard and reconcile by hand. A retry pass belongs with `/api/cron/sweep`.
- **The vendor's side of a dispute is read-only.** A vendor is notified when a case
  reduces their payout and can read the resolution, but cannot respond before it is
  decided. That is a deliberate MVP cut, not an oversight: a two-sided case needs a
  reply window, which needs its own deadline, which needs its own sweep. Revisit
  once the pilot shows how often admins actually want the store's account.

- Delivery-agent payouts are out of scope for the MVP: the delivery fee settles to
  the platform account, not to the agent who earned it.


- Agent ratings are now readable by an admin on `/admin/analytics` (Phase 12), but
  still **not by students**. Surfacing a courier's score to the student about to
  meet them is a design question — it invites refusing an agent — and remains
  deliberately unbuilt.
- Individual review comments are not shown publicly — only the average and the
  count. Listing free text to strangers needs the moderation queue to be watched
  habitually, which is an operational decision for the pilot.
- Nobody is nudged to rate. The Phase 9 notification machinery could send a
  reminder, but a nudge for something optional is close to nagging; decide it with
  real data on how many students rate unprompted.
- A rating hides/restores cleanly, but there is no way for a vendor or agent to
  reply to one. A reply is a second voice in what is currently one buyer's report
  of one delivery, and it needs its own moderation story.
- **The analytics dashboard computes every figure on request.** Twenty-odd
  aggregates run concurrently per page load, and the medians and daily series read
  rows. Fine for a pilot campus; if a campus grows past a few thousand orders a
  month, the fix is a nightly rollup table, not a wider `take`. Phase 14 territory.
- **Analytics has no CSV export and no scheduled digest.** An admin who wants last
  month's numbers in a spreadsheet has to read them off the screen. The service
  returns plain objects, so an export route is small — it was left out because
  nobody has asked for a specific format yet.
- **Super Admin has no cross-campus roll-up screen.** The service accepts an
  explicit `campusId`, so a Super Admin can read any single campus, but "all
  campuses summed" is not built. Summing campuses that price delivery differently
  needs a decision about what the total means.
- Product images are stored privately and streamed by
  `/api/products/images/[imageId]`, which means no CDN caching for listing photos.
  Revisit in Phase 14 (performance) if browse latency matters.
- `soldCount` on `Product` is incremented at checkout and decremented when an
  unpaid order is cancelled, so "most popular" counts placed orders, not delivered
  ones. Revisit if that proves misleading once deliveries exist.
- The delivery fee is `0` when either the campus or the chosen location has no
  coordinates — the fee formula cannot invent a distance. Campus Admins should be
  told to set coordinates before the pilot.

- Marketplace search uses `contains` with `mode: "insensitive"`. Adequate for the
  ABUAD pilot; Phase 14 should consider Postgres full-text search or a trigram
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
