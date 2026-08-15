# Phase 3 — Vendor System

Status: complete. `npm run build` and `npm run test` both pass (46 tests, 5 files).

## What was implemented

- **Vendor application (PRD §17).** One application per user, one store per vendor
  (§19). Store name, description, phone, storefront location plus two mandatory
  private uploads (storefront photograph, identity/business document). Re-applying
  after `REJECTED` or `CORRECTION_REQUESTED` reuses the same profile row.
- **Student-vendor toggle (PRD §18).** `CampusSettings.allowStudentVendors` is
  checked server-side at application time; a student on a campus with the toggle
  off is rejected with `STUDENT_VENDORS_DISABLED`, not merely hidden in the UI.
- **Verification queue (PRD §17, §8).** Campus Admin can approve, reject or
  request a correction, and suspend/reinstate an approved store. Every decision
  re-reads the row inside a transaction, checks the reviewer's campus and the
  current status, and writes an audit log entry.
- **Store management.** Vendors edit store details, set a weekly opening-hours
  schedule (§23) and pause/resume orders manually. `isOpenNow` is derived
  server-side from the campus timezone, never from the browser clock.
- **Marketplace exposure (Phase 3 acceptance).** `GET /api/marketplace/vendors`
  returns only `APPROVED` stores on the caller's campus. Pending, rejected and
  suspended stores are excluded in the query itself (Rule 25).

## Files added

Server / domain
- `prisma/schema.prisma` — `VendorProfile`, `VendorOperatingHours`, vendor
  document types, vendor status enum, `@@unique([campusId, slug])`,
  `@@unique([userId])`.
- `validations/vendor.ts` — application, update, hours, review and status schemas;
  `storeNameSchema`, `slugifyStoreName`.
- `lib/vendors/operating-hours.ts` — timezone-aware open/closed evaluation,
  minute-of-day helpers, default week.
- `lib/vendors/vendor-service.ts` — `getVendorState`, `applyForVendor`,
  `updateStore`, `replaceOperatingHours`, `setAcceptingOrders`,
  `listVendorsForReview`, `reviewVendorApplication`, `setVendorStatus`,
  `listStorefronts`, `requireApprovedVendor`.
- `lib/audit/audit-log.ts` — added `VENDOR_APPROVED`, `VENDOR_REJECTED`,
  `VENDOR_CORRECTION_REQUESTED`, `VENDOR_SUSPENDED`, `VENDOR_REINSTATED`,
  `VENDOR_APPLIED`.

API
- `POST/PATCH/GET /api/vendors/me`
- `PUT /api/vendors/me/hours`
- `POST /api/vendors/me/accepting-orders`
- `POST /api/vendors/documents` (private upload)
- `GET /api/admin/vendors`, `POST /api/admin/vendors/[vendorProfileId]/review`,
  `POST /api/admin/vendors/[vendorProfileId]/status`
- `GET /api/marketplace/vendors`

UI
- `app/vendor/layout.tsx`, `app/vendor/store/page.tsx`
- `components/vendors/store-manager.tsx` (apply / pending / suspended / manage)
- `app/admin/vendors/page.tsx`, `components/admin/vendor-review-list.tsx`
- `app/admin/layout.tsx` — added the Vendors link
- `lib/api/client.ts` — added `apiPut`

## Database migrations

- `prisma/migrations/<timestamp>_vendor_system/` — vendor profile, operating
  hours, enums and the per-campus store-slug unique index.

Apply with `npx prisma migrate deploy` (or `migrate dev` locally). `npm run build`
runs `prisma generate` first, so the client is always regenerated on deploy.

## Environment variables

No new variables. Phase 3 reuses the Phase 0–2 configuration
(`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, storage settings).

## Tests

- `tests/vendor-hours.test.ts` (15 tests): campus-timezone day/minute resolution
  including the midnight rollover, open/closed edges (closing minute is closed,
  unconfigured day is closed), minute-of-day parsing, full-week schema validation
  (missing day, duplicate day, inverted window, open day without times), and
  store-name slug collisions that the unique index is meant to catch.
- Full suite: 46 tests across 5 files, all passing.

## Known issues / notes

- Vendor evidence is served through `/api/students/documents/[documentId]`, which
  authorises by document owner and campus. The path name is now misleading; it
  should become `/api/documents/[documentId]` in a later pass.
- Suspension does not yet cancel in-flight work, because orders and deliveries do
  not exist until Phases 5–6. `requireApprovedVendor` is already the single gate
  those phases will call.
- Vendor ratings are deliberately not implemented here; they belong to Phase 10.
  The marketplace listing exposes no rating field yet.
- Repeated-cancellation suspension (Rule 27) needs the delivery engine and is
  scheduled for Phase 6/11.

## Phase 3 acceptance

An approved vendor appears in `GET /api/marketplace/vendors` for students on the
same campus; pending, rejected and suspended vendors do not. Verified by the
query-level filters and the campus-isolation tests.
