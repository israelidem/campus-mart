# Phase 5 — Cart & checkout

Scope from the PRD: multi-vendor cart, master invoice, per-vendor orders, price
snapshots, campus delivery locations, distance and delivery fee.

## What was built

Schema (`prisma/migrations/20260815141805_phase_5_cart_checkout`)

- `Cart` — one per student per campus, unique on `(studentId, campusId)`.
- `CartItem` — unique on `(cartId, productId)`, so adding the same product twice
  raises a line rather than creating a second one.
- `DeliveryLocation` — campus-curated destination, optional coordinates, unique
  slug per campus, deactivated rather than deleted.
- `Order` — the master invoice: reference, destination name, note, contact phone,
  distance, goods subtotal, delivery fee, total, cancellation fields.
- `VendorOrder` — one slice per store, carrying its own status and the
  **snapshotted** `commissionBps`, `commissionKobo` and `vendorPayoutKobo`.
- `OrderItem` — snapshotted product name, unit label and unit price.
- Every table carries `campusId`.

Services

- `lib/orders/cart-view.ts` — pure pricing and buyability for the cart. No Prisma
  import, so it is unit-testable.
- `lib/orders/cart-service.ts` — verified-student gate, add/update/remove/clear,
  all campus-scoped in the query.
- `lib/orders/order-service.ts` — checkout, order reads, the vendor fulfilment
  transitions and cancellation.
- `lib/orders/order-reference.ts` — `CM-XXXX-XXXX` references, alphabet chosen so
  the code can be read aloud without ambiguity.
- `lib/orders/delivery-location-service.ts` — Campus Admin CRUD, coordinates
  stored as a pair or not at all.
- `lib/delivery/pricing.ts` — haversine distance and the fee formula
  (`base + perKm × km`, clamped to the campus minimum and maximum).

API (`app/api/...`) — `cart`, `cart/items/[cartItemId]`, `orders`,
`orders/[orderId]`, `orders/[orderId]/cancel`, `vendors/me/orders`,
`vendors/me/orders/[vendorOrderId]`, `delivery-locations`,
`delivery-locations/[locationId]`. Handlers authenticate, validate with
`validations/order.ts`, call a service, and return the envelope.

UI — `/cart` (cart + checkout), `/orders` and `/orders/[orderId]` (invoice, with
cancel while unpaid), `/vendor/orders` (fulfilment queue with payout breakdown),
`/admin/delivery-locations`, and an add-to-cart control on the product page.

## Decisions worth knowing

- **Nothing monetary is trusted from the client.** `checkoutSchema` strips any
  price a caller sends; the subtotal, commission and delivery fee are all derived
  server-side from current rows and then frozen on the order.
- **Stock is reserved with a conditional update** —
  `updateMany({ where: { stockQuantity: { gte: quantity } } })`. If it matches no
  row, the whole checkout transaction aborts. That is the primitive that makes the
  two-buyers-one-unit race safe; stock cannot go negative.
- **Every stock movement is an `InventoryTransaction`** (`SALE` at checkout,
  `RETURN` on cancellation), so a stock level can always be explained.
- **Vendors cannot complete an order.** The transition table allows
  `PLACED → PREPARING → READY_FOR_PICKUP` and nothing further; handover and
  completion belong to the delivery engine (Phase 6).
- **Cancellation is only allowed while `AWAITING_DELIVERY_PAYMENT`.** Once money
  has moved the answer is a refund, which is Phase 8. Cancelling returns every
  reserved unit and writes an audit entry.
- **No delivery fee is previewed in the browser.** The fee depends on the chosen
  destination and is computed at checkout; a client-side estimate would be a
  promise the server has not made.

## Verification

- `npm run test` — 110 tests / 10 files pass, including 22 new ones:
  `tests/delivery-pricing.test.ts` (haversine, fee clamping, reference format) and
  `tests/cart-view.test.ts` (grouping, arithmetic, the six unorderable reasons,
  and the order validation schemas).
- `npm run lint` — clean.
- `npm run build` — compiles, typechecks and prerenders 62 routes.

## Left for later phases

- Paying the delivery fee, goods payment, splits and refunds (Phase 8).
- Assignment to a delivery agent, the 15-minute pickup rule, destination lock
  (Phase 6).
- `distanceMeters` comes from `MAP_PROVIDER=haversine`. A real routing provider
  can replace `lib/delivery/pricing.ts`'s distance source without touching the
  fee formula.
- Orders have no rating hook yet; ratings are Phase 10.
