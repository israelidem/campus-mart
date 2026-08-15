# Phase 8 — Paystack payments

Scope: PRD §30–35 (delivery-fee payment), §46–50 (goods payment, splits,
commission, webhooks, idempotency, refunds).

Phase 7 left a delivery sitting in `PAYMENT_PENDING` with a deadline and no way
to pay. This phase supplies the money: the two chargeable moments, the split that
pays the vendor, and the machinery that makes a payment provider's retries
harmless.

## What was built

**Provider boundary — `lib/payments/paystack.ts`**
Everything that speaks HTTP to Paystack, and nothing that knows about orders.
Initialise, verify, refund, reference generation and webhook signature checking.
Amounts are kobo integers, which is also Paystack's unit for NGN, so no
conversion happens anywhere. A missing `PAYSTACK_SECRET_KEY` raises
`PAYMENTS_NOT_CONFIGURED` (503) rather than a stack trace, so a deployment
without payment keys degrades honestly.

**Settlement — `lib/payments/settlement.ts`**
Pure functions. `goodsSettlement` turns a vendor order's frozen figures into a
flat split: the vendor's payout goes to their subaccount, and whatever is left —
the commission — stays in the platform account. It refuses a split that does not
balance, which is the guard against a rounding change silently paying the wrong
person. `deliveryFeeSettlement` routes nothing: the fee stays with the platform,
because agent payouts are not in the MVP. Money never sits in an internal wallet
(Rule 3); Paystack holds and settles it.

**Schema — `Payment`, `PaymentEvent`**
`Payment` records one attempt: purpose, our reference (unique), amount, the split
figures, status, and the delivery it belongs to when it is a goods payment. Rows
are written *before* the student leaves for the provider, so a payment that fails
mid-flight is still visible to whoever has to explain it. `PaymentEvent` stores
every webhook keyed by `providerEventKey` with a unique constraint — that
constraint is the idempotency mechanism.

**Service — `lib/payments/payment-service.ts`**
- `initialiseDeliveryFeePayment(actor, orderId)` — order must be
  `AWAITING_DELIVERY_PAYMENT`, owned by the actor, in the actor's campus.
- `initialiseGoodsPayment(actor, deliveryId)` — delivery must be
  `PAYMENT_PENDING` and inside the window Phase 7 opened. A lapsed deadline is
  refused: the goods are already going back.
- `handlePaystackWebhook(rawBody, signature)` — verify signature over raw bytes,
  insert the event (duplicate ⇒ stop), re-verify with Paystack, apply.
- `verifyPaymentForActor(actor, reference)` — the callback path, which applies
  through the same guarded transaction.
- `refundPayment(reference, reason)` — full-amount only; partial refunds are
  Phase 11.

**API**
`POST /api/payments/delivery-fee`, `POST /api/payments/goods`,
`POST /api/payments/webhook`, `GET /api/payments/[reference]`.

**UI**
`components/payments/pay-button.tsx` and `app/orders/payment/callback`. The order
page now offers the delivery fee when the invoice is unpaid and a goods payment
per delivery once a hand-over is verified.

## Decisions worth keeping

**A client may only ask to pay.** Requests name an order or a delivery. There is
no amount field anywhere in `validations/payment.ts` — every figure is read from
rows the server wrote at checkout (Rule 1). A tampered client can pick a
different order, and will be told it is not theirs.

**A webhook body is a notification, not evidence.** The signature proves the
request came from Paystack; it does not prove what happened. So every
`charge.success` is followed by `verifyTransaction`, and the amount and status
used are the ones Paystack reports.

**Idempotency is a database constraint, not a code path.** Two mechanisms, one
per failure mode: the unique `providerEventKey` stops a re-delivered event, and
the guarded transaction — which re-reads the payment and returns early if it is
already `SUCCESS` or `REFUNDED` — stops the callback and the webhook from both
applying the same money.

**An amount mismatch is never reconciled.** The payment is marked `FAILED` with
the two figures in `failureReason`, the goods stay locked, and a human decides.

**Money that arrives too late is sent back.** A goods payment that lands after
the delivery has timed out and returned is refunded rather than kept, and the
refund happens outside the transaction so a provider failure cannot roll back the
record of it.

**The effect belongs to another service.** This module writes no delivery or
order status of its own: a settled delivery fee calls
`publishDeliveriesForPaidOrder`, and a settled goods payment calls
`completeDeliveryOnGoodsPayment`. Rule 4 holds — state changes stay in the named
operations that own them.

**A vendor without a subaccount does not block a sale.** The split is skipped,
`vendorRouted` is stored as `false`, the platform's share is recorded as the whole
amount, and a warning is logged. Pretending the split happened would be the
worse failure.

## Tests

`tests/payment-settlement.test.ts` — 20 cases. Split arithmetic including the
unbalanced-split and fractional-kobo refusals, exact-amount matching, provider
status interpretation, and signature verification: right secret, tampered body,
wrong secret, missing and malformed headers.

`verifyWebhookSignature` now takes the secret as a parameter defaulting to the
environment lookup, so the check is testable as the pure function it is.

Whole suite: 162 tests / 13 files passing.

## Known gaps

- Delivery-agent payouts are out of scope; the fee stays with the platform.
- Refunds are full-amount and have no admin UI — Phase 11.
- Vendor subaccount codes are read from `VendorProfile.paystackSubaccountCode` but
  nothing creates them yet; onboarding a vendor to Paystack is still manual.
- The goods-payment timeout still needs the scheduled sweep noted in Phase 7;
  until then a lapsed window is only enforced when someone acts.
- The webhook is unauthenticated by design (Paystack has no session) and is
  protected solely by the HMAC signature. It must be reachable publicly, and
  `PAYSTACK_SECRET_KEY` must match the dashboard for the right environment.
