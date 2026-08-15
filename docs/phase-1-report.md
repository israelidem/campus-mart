# Phase 1 — Authentication & User Management

Status: code complete, verified by lint, typecheck, unit tests and a production build.
Database migration is still pending (no reachable Postgres yet — see "Known issues").

## What was implemented

Student identity and verification, end to end (PRD §12–16):

- Registration through `POST /api/students/register`, not Better Auth's sign-up endpoint
  directly, so the server decides role (`STUDENT`) and campus after checking the campus exists
  and is `ACTIVE`.
- Email verification handled by Better Auth; the student cannot upload documents or submit
  details until the address is confirmed.
- Onboarding submission: matric number, optional student ID number, department, level, phone,
  plus a passport photograph and student ID card.
- Private document storage. Documents are never publicly addressable; they are streamed through
  an authorising route and served `private, no-store`.
- Duplicate protection on `(campusId, matricNumber)` and `(campusId, studentIdNumber)` enforced
  by database unique constraints, with a friendlier pre-check for the common case.
- Registry matching: a submission is flagged `registryMatched` when the matric number exists in
  that campus's imported registry.
- Campus Admin review queue with approve / reject / request-correction, each writing an audit
  entry. Rejections and correction requests require a note, which is shown back to the student.
- Registry CSV import (`matric_number,name` minimum, `department` and `level` optional) that
  reports invalid and duplicate rows with line numbers instead of silently dropping them.

Verification state machine: `INCOMPLETE → PENDING_VERIFICATION → APPROVED | REJECTED |
CORRECTION_REQUESTED`, with re-submission allowed only from `INCOMPLETE`,
`CORRECTION_REQUESTED` and `REJECTED`. A submission can only be reviewed while
`PENDING_VERIFICATION`, so two admins cannot both decide it.

## Files added

Business logic and validation
- `lib/students/student-service.ts` — onboarding, review, document access, registry import
- `lib/students/registry-csv.ts` — pure CSV parser
- `lib/storage/storage.ts` — private document storage abstraction (local disk now, R2 later)
- `validations/student.ts` — Zod schemas
- `lib/api/client.ts` — browser API client that unwraps the response envelope

API routes
- `POST /api/students/register`
- `GET /api/campuses` (active campuses, for the sign-up form)
- `GET /api/students/me`
- `POST /api/students/documents`, `GET /api/students/documents/[documentId]`
- `POST /api/students/profile`
- `GET /api/admin/students`
- `POST /api/admin/students/[studentProfileId]/review`
- `POST /api/admin/students/registry`

UI
- `app/(auth)/layout.tsx`, `sign-up`, `sign-in`, `verify-email`
- `app/after-sign-in/page.tsx` — server-side role routing
- `app/student/layout.tsx`, `app/student/onboarding/page.tsx`
- `app/admin/layout.tsx`, `app/admin/students/page.tsx`
- `components/students/onboarding-form.tsx`, `components/admin/student-review-list.tsx`

Modified
- `prisma/schema.prisma` — `StudentProfile`, `OnboardingDocument`, `StudentRegistryEntry`,
  `VerificationStatus`, `DocumentType`
- `lib/audit/audit-log.ts` — added student verification and registry actions

## Database changes

New models: `StudentProfile`, `OnboardingDocument`, `StudentRegistryEntry`.
New enums: `VerificationStatus`, `DocumentType`.

Constraints and indexes that carry security or correctness weight:
- `StudentProfile @@unique([campusId, matricNumber])`
- `StudentProfile @@unique([campusId, studentIdNumber])`
- `StudentProfile.userId` unique (one profile per user)
- `StudentRegistryEntry @@unique([campusId, matricNumber])`
- Campus-scoped indexes on `StudentProfile(campusId, status)` and `OnboardingDocument(campusId)`

No migration file has been generated yet. Run once a database is reachable:

```
npx prisma migrate dev --name student_onboarding
```

## Environment variables

No new required variables. Storage uses these, with working defaults for development:

- `DOCUMENT_STORAGE_DRIVER` — `local` (default) or `r2`
- `DOCUMENT_STORAGE_DIR` — local driver only, defaults to `.storage/documents`
- R2 variables (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`) are
  only read when the driver is `r2`, which is wired in Phase 8's storage work.

## Tests

`npx vitest run` — 22 passing across 3 files.

- `tests/registry-csv.test.ts` (new, 8 tests): valid rows, the PRD's minimal two-column format,
  invalid rows reported with line numbers, in-file duplicates, quoted fields containing commas,
  BOM/CRLF/blank-line tolerance, missing headers, empty file.
- `tests/campus-isolation.test.ts`, `tests/money.test.ts` — unchanged, still passing.

Also verified: `npx tsc --noEmit`, `npm run lint`, `npm run build` (18 routes, no errors).

## Known issues / what is not done

1. **No migration applied.** The schema is written but never pushed; `DATABASE_URL` does not yet
   point at a reachable Postgres instance. Nothing involving the database has been exercised at
   runtime — only compiled and unit-tested.
2. **Email delivery is not wired.** PRD §53 excludes email infrastructure from the MVP, so the
   Better Auth verification link is currently logged server-side rather than emailed. This has to
   be resolved before a real pilot, since email verification gates onboarding.
3. **`after-sign-in` points at routes that do not exist yet** for `VENDOR`, `DELIVERY_AGENT`,
   `SUPER_ADMIN` and the `/suspended` page. Those arrive in Phases 2–3.
4. **No rate limiting yet** on registration, document upload or review endpoints. PRD §55 requires
   it; it is scheduled for Phase 13 but registration and upload are the obvious abuse targets and
   should probably be brought forward.
5. **Local disk storage is not production-safe** on Vercel. The R2 driver must be implemented
   before deployment.
6. **No integration tests.** Campus isolation and authorization are enforced in the service layer
   and covered by reasoning, not by tests that hit a database. Those need a test Postgres instance.

## Before Phase 1 is considered complete

- Provision Neon, set `DATABASE_URL`, run the migration.
- Manually walk the acceptance path: register → verify email → submit details → admin approves.
- Add integration tests for cross-campus access attempts (Campus Admin A reviewing a Campus B
  student, student A reading student B's document).
