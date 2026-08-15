# Phase 2 — Campus Management

Covers PRD Part D (multi-campus architecture), §8–§9 (admin roles), §18/§29/§35/§47
(campus-configurable rules) and the Phase 2 acceptance criteria.

## What was implemented

- **CampusSettings model** — one row per campus, created inside the same transaction as
  the campus, so a campus can never exist without configuration. Holds vendor
  eligibility (`allowStudentVendors`, `requireRegistryMatch`), delivery pricing
  (base / per-km / minimum / maximum, all integer kobo), `commissionBps`
  (default 250 = 2.5%) and the three delivery timers (pickup window, student wait,
  goods-payment window) that later phases read instead of hard-coding.
- **Campus service** (`lib/campus/campus-service.ts`) — create, read, update,
  activate/deactivate, list Campus Admins, assign a Campus Admin, and update settings.
  Every mutation writes an audit entry inside the same transaction.
- **Authorization** — campus creation, updates, status changes and admin assignment are
  Super Admin only. Settings may be changed by the Super Admin or by a Campus Admin for
  their own campus; `assertSameCampus` guards every path that accepts a campus id.
- **API routes**
  - `GET/POST /api/super-admin/campuses`
  - `GET/PATCH /api/super-admin/campuses/[campusId]`
  - `POST /api/super-admin/campuses/[campusId]/status`
  - `GET/POST /api/super-admin/campuses/[campusId]/admins`
  - `GET/PATCH /api/admin/campus` — the admin's own campus; the campus id comes from the
    session, never from the request body.
- **UI** — `/super-admin/campuses` (create a campus, activate/deactivate, assign an admin
  by email) and `/admin/settings` (campus configuration). Fees are entered in naira and
  converted to integer kobo before submission; commission is entered as a percentage and
  sent as basis points.

## Design decisions worth noting

- **The campus code is immutable.** It is short, uppercase, unique, and campus-scoped
  identifiers depend on it, so `PATCH` deliberately omits it.
- **Admin assignment promotes an existing account** rather than creating one. The account
  must have a confirmed email, must not be a Super Admin, and must not already hold a
  student profile — a campus-scoped profile belongs to a different role and silently
  repurposing it would corrupt that user's records.
- **Commission and pricing changes are audited separately** from other settings, because
  they alter platform economics. Changes apply to future records only: the delivery fee is
  snapshotted onto each delivery when it is created (PRD §29).
- **Guard rails on configuration**: commission is capped at 20%, fees at ₦20,000, timers
  between 5 and 60 minutes, and the minimum fee cannot exceed the maximum (checked after
  merging with the stored row, since a partial update may change only one side).

## Files added

```
prisma/schema.prisma                                    (CampusSettings model)
validations/campus.ts
lib/campus/campus-service.ts
lib/api/client.ts                                       (apiPatch added)
app/api/super-admin/campuses/route.ts
app/api/super-admin/campuses/[campusId]/route.ts
app/api/super-admin/campuses/[campusId]/status/route.ts
app/api/super-admin/campuses/[campusId]/admins/route.ts
app/api/admin/campus/route.ts
app/super-admin/layout.tsx
app/super-admin/campuses/page.tsx
app/admin/settings/page.tsx
app/admin/layout.tsx                                    (Settings link)
components/super-admin/campus-manager.tsx
components/admin/campus-settings-form.tsx
tests/campus-settings.test.ts
```

## Migrations

`prisma/migrations/20260815082625_init_phases_0_to_2/` — the initial migration covering
Phases 0–2 (Better Auth tables, campus, campus settings, student profile and documents,
student registry, audit log). Applied to the Neon database; `GET /api/health` reports
`database: "up"`.

`prisma.config.ts` now prefers `DIRECT_DATABASE_URL` for CLI work. Migrations and Studio
cannot run through a connection pooler — the pooler cannot hold the advisory lock and
session state that DDL needs — while the app runtime continues to use the pooled
`DATABASE_URL`. The pooled/direct split the project was given is exactly right.

## Environment variables

- `SUPER_ADMIN_EMAILS` — comma-separated emails promoted to Super Admin on sign-in once
  their email is verified. Defaults to `israelidem20@gmail.com`. Documented in
  `.env.example`.


## Tests

`npm run test` → 31 passing across 4 files. New: `tests/campus-settings.test.ts`
(9 tests) covering code normalisation, defaulting, fractional-kobo rejection, the
commission cap, empty-update rejection, announcement clearing, and fee-bound coherence.

`npm run build` compiles and type-checks cleanly (25 routes).

Note: `npx tsc --noEmit` alone reports two errors from stale route types under
`.next/dev/` while the dev server is running. They disappear on a build, which regenerates
those types. Use `npm run build` as the type gate.

## Known gaps / carried into later phases

- The Neon database is connected and migrated, but the campus flows have not yet been
  clicked through end to end. Campus creation, admin assignment and settings updates are
  covered by unit tests at the validation boundary only.
- Email verification has no delivery provider yet (PRD §53 excludes email for MVP). In
  development the verification link is written to the dev-server log by
  `sendVerificationEmail`; open it from the terminal to verify an account. This blocks the
  Super Admin bootstrap until the link is followed, since promotion requires a verified
  email.


- Campus Admin suspension and removal are not implemented; only assignment is. The audit
  actions (`USER_SUSPENDED`) exist for when they are.
- `requireRegistryMatch` is stored and editable but not yet enforced during student
  approval — that wiring belongs with the registry work it depends on.
- Campus locations (PRD §27) are deliberately deferred to the delivery phases.

## Phase 2 acceptance

> Super Admin creates ABUAD and assigns an admin. Campus Admin sees only ABUAD.

Satisfied in code: `/super-admin/campuses` creates the campus and promotes an admin;
`/api/admin/campus` and `/admin/settings` resolve the campus from the session, and
`assertSameCampus` rejects any attempt to reach another campus. The database is migrated
and reachable; a manual click-through of the flow is still outstanding.


