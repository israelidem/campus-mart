# Phase 7 — Delivery hand-over code and goods-payment unlock

Scope from the PRD: §45 (hand-over verification) and §46 (goods payment window
and timeout). Phase 7 closes the gap the delivery engine left open — an agent
arrives with a package, and something has to prove the student actually received
it before their money for the goods can move.

## What was built

**`lib/delivery/otp.ts`** — the code primitive, with no database or Prisma in it
so it is unit-testable in isolation:

- `generateHandoverCode()` — six digits from `crypto.randomInt`, leading zeros
  preserved. Not derived from the delivery id, the clock, or anything an agent
  can see.
- `hashHandoverCode({ code, deliveryId, secret })` — HMAC-SHA256 over the
  normalised code, keyed by `BETTER_AUTH_SECRET` and **bound to the delivery id**,
  so a captured digest cannot be replayed against another delivery.
- `hashesMatch()` — constant-time comparison, and it refuses empty or malformed
  stored hashes rather than letting `"" === ""` pass for a match.
- `checkOtpUsable()` / `attemptsRemaining()` — the pure decision about whether a
  code may still be tried: issued, not already verified, not expired, not locked.

**Schema** (`20260815174000_phase_7_handover_otp`): `Delivery` gains `otpHash`,
`otpIssuedAt`, `otpExpiresAt`, `otpAttempts`, `otpIssueCount`, `otpVerifiedAt`
and `goodsPaymentDeadline`; `DeliveryStatus` gains `AWAITING_OTP` and
`PAYMENT_PENDING`; `DeliveryEventType` gains `OTP_ISSUED`, `OTP_FAILED`,
`OTP_VERIFIED`, `PAYMENT_TIMED_OUT`. Only the hash is ever stored.

**Service operations** in `lib/delivery/delivery-service.ts`, each a named
transaction that re-reads and asserts state:

| Operation | Actor | Effect |
| --- | --- | --- |
| `issueHandoverCode` | student | `ARRIVED`/`AWAITING_OTP` → `AWAITING_OTP`, returns the plaintext once, resets attempts |
| `verifyHandoverCode` | assigned agent | `AWAITING_OTP` → `PAYMENT_PENDING`, sets `goodsPaymentDeadline`, clears the hash |
| `completeDeliveryOnGoodsPayment` | Paystack webhook (Phase 8) | `PAYMENT_PENDING` → `COMPLETED`, closes the vendor order and, if it was the last one, the invoice |
| `expireGoodsPayments` | sweep | `PAYMENT_PENDING` past its deadline → `RETURNED`, vendor order cancelled, stock returned as `RETURN` movements |

**API**: `POST /api/deliveries/[deliveryId]/handover-code` (student) and
`POST /api/deliveries/[deliveryId]/verify-code` (agent). Both are thin: actor,
Zod, service, envelope.

**UI**: `components/delivery/handover-code.tsx` on the student's order page and
`components/delivery/handover-verify.tsx` inside the agent console, shown from
arrival until the hand-over is confirmed.

## Decisions worth keeping

- **The student issues the code, not the agent.** An agent who could mint the
  code could release payment for goods they never handed over. The code is the
  student's assertion that the package is in their hands.
- **Shown once, replaceable.** The plaintext exists only in the issuing response.
  Asking again mints a new code and invalidates the old one, which doubles as the
  recovery path for a locked or expired code — and it puts that recovery in the
  student's hands, not the agent's.
- **Server-side clocks only.** `otpExpiresAt` and `goodsPaymentDeadline` are
  written by the server and compared to its own clock. Nothing in a request can
  buy time.
- **Wrong tries are counted in the row, not the client**, and the attempt limit
  kills the code rather than the session. The UI reports only what the server
  said.
- **Completion is a seam, not a route.** Only the payment provider may declare
  money received, so `completeDeliveryOnGoodsPayment` is exported for Phase 8's
  webhook and is idempotent for retries. There is no endpoint an agent or student
  can call to mark goods paid.
- **A timed-out payment returns the goods**, restoring stock as recorded
  `InventoryTransaction` rows. The delivery fee is not refunded — the trip
  happened (PRD §46).
- **The audit trail never contains a code**, only that one was issued, failed or
  verified.

## Verification

- `npm run test` → 12 files, 143 tests passing, including
  `tests/handover-otp.test.ts` (format, delivery/secret binding, constant-time
  match, malformed-hash rejection, expiry, lock, attempt countdown).
- `npm run build` → compiles and typechecks clean.

## Deferred to Phase 8

Taking the goods payment itself: initialising the Paystack transaction against
`PAYMENT_PENDING`, the split and commission, and calling
`completeDeliveryOnGoodsPayment` from the verified webhook. `expireGoodsPayments`
also needs a scheduled trigger; today it is a callable sweep.
