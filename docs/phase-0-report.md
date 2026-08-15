# Phase 0 — Foundation: report

Status: **complete**, with one item deferred (deployment, which needs your accounts).

## What was implemented

- **Project scaffold.** Next.js 16 App Router + React 19 + TypeScript (strict, plus
  `noUncheckedIndexedAccess`), Tailwind CSS v4, ESLint 9 flat config using `eslint-config-next`'s
  native flat configs.
- **Database layer.** Prisma 7 with the PostgreSQL driver adapter (`@prisma/adapter-pg` + `pg`).
  A single shared client (`lib/db/prisma.ts`), cached across hot reloads, is the only permitted
  `PrismaClient` instance (enforced by an ESLint rule for `app/`, `components/`, `services/`).
- **Schema foundation** (`prisma/schema.prisma`): `Campus`, Better Auth's `User` / `Session` /
  `Account` / `Verification`, and `AuditLog`. `User.role` (`UserRole` enum) and `User.campusId`
  exist from the first migration so campus isolation and RBAC are structural, not bolted on.
- **Authentication.** Better Auth 1.6 with email + password, mandatory email verification,
  password reset, 30-day sessions with a 5-minute cookie cache, and built-in rate limiting.
  `role` and `campusId` are declared as non-client-writable additional fields. Verification and
  reset URLs are logged rather than emailed (email infrastructure is out of MVP scope per PRD §53).
- **Authorization primitives.** `lib/auth/session.ts` resolves the actor from the database on every
  request (never from cookie claims) and provides `requireActor` / `requireRole` /
  `requireCampusActor`. `lib/authorization/campus.ts` provides `campusScope`, `campusFilter`,
  `assertSameCampus` and `assertOwnership`.
- **Money.** `lib/money.ts` — all amounts are integer kobo, with checked conversion, summation,
  multiplication, basis-point commission and min/max fee clamping. No floating-point money.
- **Error handling.** `lib/errors.ts` (typed error taxonomy with HTTP statuses and stable codes)
  and `lib/api/handler.ts` (`apiHandler` wrapper producing `{ ok, data }` / `{ ok, error }`
  envelopes, mapping Zod and Prisma P2002 failures, and never leaking internal messages).
- **Logging.** `lib/logger.ts` — single-line JSON logs with level filtering and redaction of
  passwords, tokens, cookies, signatures, OTPs, matric numbers and account numbers.
- **Audit logging.** `lib/audit/audit-log.ts` with a named action catalogue; can join an existing
  transaction or fire-and-log-on-failure outside one.
- **Base UI.** Mobile-first shell (safe-area padding, `100dvh`, capped width), `Button`, `Card`,
  `Input`/`Label`/`Field` with accessible error wiring, reduced-motion and focus-visible support,
  route error boundary that shows only a digest, and a 404 page.
- **Security headers** in `next.config.ts`: `nosniff`, `DENY` framing, strict-origin referrer,
  restricted permissions policy; `X-Powered-By` disabled.
- **Health endpoint.** `GET /api/health` (200 healthy / 503 degraded).
- **Env configuration.** `lib/env.ts` validates server variables with Zod, lazily and
  server-only; `publicEnv` exposes just the `NEXT_PUBLIC_*` values.

## Files created

```
package.json  tsconfig.json  next.config.ts  postcss.config.mjs  eslint.config.mjs
vitest.config.mts  .gitignore  .env.example  .env (local placeholders)  README.md
prisma/schema.prisma  prisma.config.ts
app/layout.tsx  app/page.tsx  app/globals.css  app/error.tsx  app/not-found.tsx
app/api/auth/[...all]/route.ts  app/api/health/route.ts
components/ui/button.tsx  components/ui/card.tsx  components/ui/field.tsx
lib/env.ts  lib/logger.ts  lib/errors.ts  lib/money.ts  lib/utils.ts
lib/db/prisma.ts  lib/auth/auth.ts  lib/auth/client.ts  lib/auth/session.ts
lib/authorization/campus.ts  lib/api/handler.ts  lib/audit/audit-log.ts
tests/money.test.ts  tests/campus-isolation.test.ts
docs/PRD.docx (moved)  docs/phase-0-report.md
```

## Database migrations

**None yet.** The schema is written and validated, but no migration has been generated because
there is no reachable database in this environment. Run this once `DATABASE_URL` points at your
Neon database:

```bash
npx prisma migrate dev --name phase-0-foundation
```

## Environment variables required

Now: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`.
Optional now, required later: `DIRECT_DATABASE_URL`, `PAYSTACK_*`, `R2_*`, VAPID keys, `MAP_*`,
`DEFAULT_COMMISSION_BPS`, `LOG_LEVEL`. All documented in `.env.example`.

## Tests

`npm test` → 14 tests passing in 2 files.

- `tests/money.test.ts` — kobo conversion, rejection of fractional/negative amounts, exact
  summation and multiplication, 2.5% commission in basis points, fee clamping, formatting.
- `tests/campus-isolation.test.ts` — campus-bound roles locked to their campus, cross-campus
  access rejected for students and campus admins, actors without a campus rejected, Super Admin
  global and scoped access, ownership and admin-override rules.

Also verified: `npm run typecheck` clean, `npm run lint` clean, `npm run build` succeeds
(4 routes compiled).

## Known issues and decisions

- **Vitest pinned to 3.2.7.** Vitest 4.1.10 failed on this machine with "Vitest failed to find the
  current suite" even for a trivial test, under both the threads and forks pools. Rather than keep
  tweaking config, the runner was downgraded to the stable 3.x line, where all tests run.
- **Prisma 7 requires a driver adapter**, and the datasource URL now lives in `prisma.config.ts`
  rather than `schema.prisma`. This is handled, but note it when reading older Prisma docs.
- **`npm 12 blocks install scripts by default.** `prisma`, `@prisma/engines`, `esbuild` and
  `unrs-resolver` were explicitly approved (`npm install-scripts approve`) so engines and the
  bundler install correctly. Fresh clones may need the same approval.
- **`.env` contains placeholder values only** and is git-ignored. The placeholder
  `BETTER_AUTH_SECRET` must be replaced before any real sign-in.
- **`@eslint/eslintrc` is now unused** (the FlatCompat approach was replaced by native flat
  configs) and can be removed from devDependencies.
- **Deployment is not done.** Vercel/Neon provisioning needs your accounts and credentials.
- Email sending is intentionally absent; verification links are written to the logs.

## Remaining before Phase 0 is fully closed on your side

1. Create the Neon database and set `DATABASE_URL` (and `DIRECT_DATABASE_URL`).
2. Generate a real `BETTER_AUTH_SECRET`.
3. Run `npx prisma migrate dev --name phase-0-foundation`.
4. Deploy to Vercel and set the same variables there.
