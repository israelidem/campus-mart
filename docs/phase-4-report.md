# Phase 4 — Marketplace (categories, products, inventory, search)

Completed 2026-08-15. Scope from `docs/PRD.docx` Phase 4: product catalogue for
approved vendors and a campus-scoped browse experience for students.

---

## 1. What was built

Order followed the PRD's per-feature sequence: schema → migration → service →
validation → authorization → API → UI → tests.

### Data model (`prisma/schema.prisma`, migration `20260815103500_phase_4_marketplace`)

| Model | Purpose | Notes |
| --- | --- | --- |
| `Category` | Per-campus product categories | Unique `(campusId, slug)`; `isActive` and `sortOrder` for admin curation |
| `Product` | A vendor's listing | `campusId` + `vendorProfileId`; `priceKobo` is an integer; `deletedAt` retires a listing instead of deleting history |
| `ProductImage` | Private storefront photos | `storageKey` unique; ordered by `position` |
| `InventoryTransaction` | Append-only stock ledger | `reason` (`RESTOCK`/`ADJUSTMENT`/`SALE`/`RETURN`), signed `delta`, `resultingStock`, optional `actorId` |

Two database-level guarantees back the rules rather than trusting the service:

- `Product_stockQuantity_nonnegative` — stock can never go negative (PRD §22).
- `InventoryTransaction_delta_nonzero` — a ledger row always explains a movement.

Indexes: `(campusId, isAvailable)`, `(campusId, categoryId)`, `(campusId,
createdAt)`, `(campusId, priceKobo)`, `(vendorProfileId)`, and per-parent indexes
on images and ledger rows. Products are unique per store by slug
(`(vendorProfileId, slug)`), so one campus can host two stores selling "Jollof
rice".

### Services

- `lib/products/category-service.ts` — list (campus-scoped, active-first) and
  Campus Admin create/update. Slugs come from `lib/slug.ts`.
- `lib/products/product-service.ts` — create, update, retire, image add/remove,
  private image read, and `adjustInventory`. Every write goes through
  `requireApprovedVendor` from `lib/vendors/vendor-service`, the single approval
  gate, and writes an audit entry.
  - `resolveStockChange(current, delta)` is the pure primitive: it rejects a zero
    or fractional delta and refuses to drop below zero.
  - `adjustInventory` runs in a transaction, re-reads the row, applies a guarded
    conditional update, and appends the `InventoryTransaction`. The guarded
    update is what Phase 5's "two buyers, one unit" acceptance test will rely on.
- `lib/products/marketplace-service.ts` — `buildMarketplaceWhere`,
  `buildMarketplaceOrderBy`, `searchProducts` (paginated) and
  `getMarketplaceProduct`. The `where` clause always carries the actor's
  `campusId` (via `campusScope`), `vendorProfile.status = APPROVED` and
  `deletedAt: null`.

### Validation (`validations/product.ts`)

Prices are whole kobo and must be positive; stock is a non-negative integer and
cannot be set by a product update — only by an adjustment. `SALE` and `RETURN`
are refused as manual vendor reasons; they belong to the order pipeline.
`parseMarketplaceQuery` reads `URLSearchParams`, defaults to `NEWEST`/page 1,
treats `inStockOnly=false` as false rather than a truthy string, rejects an
inverted price range and caps `pageSize` at 100.

### API

Vendor: `POST/GET /api/vendors/me/products`,
`PATCH|DELETE /api/vendors/me/products/[productId]`,
`POST /api/vendors/me/products/[productId]/inventory`,
`POST /api/vendors/me/products/[productId]/images`,
`DELETE /api/vendors/me/products/[productId]/images/[imageId]`.

Marketplace: `GET /api/marketplace/products`,
`GET /api/marketplace/products/[productId]`,
`GET /api/products/images/[imageId]` (streams private bytes to a same-campus
member, `Cache-Control: private`).

Categories: `GET/POST /api/categories`, `PATCH /api/categories/[categoryId]`
(Campus Admin only for writes).

Handlers stay thin: authenticate, validate, call the service, return `jsonOk`.

### UI

- `app/vendor/products` + `components/vendors/product-manager.tsx` — add a
  product (price typed in naira, converted to kobo), pause/resume, adjust stock,
  upload photos, retire a listing. A store that is not `APPROVED` sees an
  explanation instead of a form.
- `app/marketplace` + `components/marketplace/product-browser.tsx` — server
  renders the first page; search, category, sort and paging then go through the
  API. The client sends only query parameters; it never filters.
- `app/marketplace/[productId]` — detail page with images, store, open/closed and
  stock state. Anything the rules hide resolves to a 404.
- Navigation links added to the vendor layout and a new marketplace layout.

## 2. Verification

- `npm run test` → 80 tests / 7 files passing (was 46/5).
  New: `tests/product-rules.test.ts` (stock primitive, price/stock validation,
  slugs) and `tests/marketplace-query.test.ts` (campus isolation, approved-only
  filter, sort/pagination, query parsing).
- `npm run lint` → clean.
- `npx tsc --noEmit` → clean.
- `npm run build` → compiled in 77s, TypeScript clean, 33 pages generated,
  49 routes.
- `npx prisma migrate deploy` → the Phase 4 migration is **applied** to the Neon
  database, and `prisma migrate diff --from-config-datasource --to-schema` reports
  "No difference detected", so the hand-written SQL matches the schema exactly.

Note: the migration SQL was written by hand in Prisma's own style rather than
generated by `migrate dev`, which is why the drift check above matters. It has
been run and is clean.


## 3. Acceptance (PRD Phase 4)

| Criterion | Status |
| --- | --- |
| An approved vendor can create products | Yes — gated by `requireApprovedVendor` |
| A student on the same campus can find and view them | Yes — `/marketplace`, `/marketplace/[id]` |
| A student on another campus cannot | Yes — `campusScope` in the query; covered by tests |
| Stock cannot go negative | Yes — service primitive plus a CHECK constraint |
| Prices are integer kobo | Yes — schema, validation and `lib/money.ts` |

## 4. Deferred, deliberately

- Sort by rating: ratings do not exist until Phase 10, so the option is absent
  rather than faked.
- Cart, checkout and price snapshots: Phase 5. `SALE`/`RETURN` ledger reasons and
  `soldCount` exist for that pipeline but nothing writes them yet.
- Product images are served through the API from private storage. If listing
  photos should be public and CDN-cached, that is a Phase 13 performance
  decision, not a Phase 4 one.
