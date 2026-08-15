# Campus Mart

A campus-specific marketplace and delivery platform. Students order from approved vendors on
their campus, verified student agents deliver, delivery is confirmed by OTP, and goods are paid
for on arrival. Built multi-campus from the first migration; first deployment target is ABUAD.

The product specification lives in [`docs/PRD.docx`](docs/PRD.docx) and is being implemented
phase by phase.

## Stack

| Concern        | Choice                                                       |
| -------------- | ------------------------------------------------------------ |
| Framework      | Next.js 16 (App Router) + React 19 + TypeScript              |
| Database       | PostgreSQL (Neon) via Prisma 7 with the `pg` driver adapter   |
| Authentication | Better Auth (email + password, email verification)            |
| Validation     | Zod                                                          |
| Styling        | Tailwind CSS v4                                              |
| Tests          | Vitest                                                       |
| Payments       | Paystack (Phase 8)                                           |
| Storage        | Cloudflare R2, private objects only (Phase 1)                |

## Getting started

```bash
npm install
cp .env.example .env.local     # then fill in the values
npx prisma migrate dev         # creates the schema in your database
npm run dev
```

Required before anything will run:

- `DATABASE_URL` — Neon (or local) Postgres connection string
- `BETTER_AUTH_SECRET` — 32+ random bytes (`openssl rand -base64 32`)
- `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL` — e.g. `http://localhost:3000`

Everything else in `.env.example` is needed only from the phase noted in the comments.

Health check: `GET /api/health` returns `{ ok: true, data: { status, database } }` and 503 when
the database is unreachable.

## Scripts

| Script                 | Purpose                                  |
| ---------------------- | ---------------------------------------- |
| `npm run dev`          | Development server                       |
| `npm run build`        | `prisma generate` + production build     |
| `npm run lint`         | ESLint                                   |
| `npm run typecheck`    | `tsc --noEmit`                           |
| `npm test`             | Vitest                                   |
| `npm run db:migrate`   | Create/apply a development migration     |
| `npm run db:deploy`    | Apply migrations (CI/production)         |
| `npm run db:studio`    | Prisma Studio                            |

## Architecture rules

These are enforced conventions, not suggestions — see PRD Part X and Part AA.

1. **The server is the source of truth.** Prices, inventory, roles, campus, commission, delivery
   fees, payment and order state are always recalculated or re-read server-side. Client input is
   never trusted for any of them.
2. **Campus isolation is server-side.** Every campus-scoped query goes through
   `campusScope()` / `assertSameCampus()` in `lib/authorization/campus.ts`. Only a Super Admin may
   query across campuses, and only explicitly.
3. **Money is integer kobo.** All amounts use `lib/money.ts`; floating-point arithmetic on money
   is never allowed. ₦2,500 is `250000`.
4. **State machines, not status writes.** Orders and deliveries expose intent-named operations
   (`acceptDelivery()`, `markPickedUp()`, …) that validate current state, actor, role, campus,
   time and ownership. Arbitrary status assignment is not permitted.
5. **Financial operations are idempotent.** Paystack webhooks are authoritative and must be safe
   to replay. Campus Mart holds no internal wallet.
6. **Sensitive documents are private.** Student IDs, passports, storefront and identity evidence
   live in private storage behind authorised, signed access.
7. **Sensitive actions are audited** through `recordAudit()` in `lib/audit/audit-log.ts`.

## Layout

```
app/                Routes: pages and API handlers (Better Auth at /api/auth/*)
components/ui/      Base UI primitives (mobile-first, accessible)
lib/
  api/              Route handler wrapper + response envelopes
  audit/            Audit logging
  auth/             Better Auth server config, browser client, actor/session helpers
  authorization/    Campus isolation and ownership checks
  db/               Shared Prisma client (driver adapter)
  errors.ts         Error taxonomy with HTTP status + stable codes
  money.ts          Kobo arithmetic
  logger.ts         Structured JSON logging with redaction
prisma/             Schema and migrations
tests/              Vitest unit tests
docs/               Product specification and phase reports
```

## Build status

- **Phase 0 — Foundation: complete.** See [`docs/phase-0-report.md`](docs/phase-0-report.md).
- Phase 1 — Authentication and student onboarding: next.
- Phases 2–17: not started.
