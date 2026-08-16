# Phase 11 — Disputes & Refunds

PRD §60–64. A student who was let down can say so; an admin can decide what happens
to the money; and the ledger can still be read afterwards.

## What was built

| Area | Files |
| --- | --- |
| Pure policy | `lib/disputes/dispute-policy.ts` |
| Validation | `validations/dispute.ts` |
| Service | `lib/disputes/dispute-service.ts` |
| Student API | `app/api/disputes/route.ts`, `app/api/disputes/[disputeId]/withdraw/route.ts`, `app/api/vendor-orders/[vendorOrderId]/dispute-context/route.ts` |
| Admin API | `app/api/admin/disputes/route.ts`, `.../[disputeId]/review/route.ts`, `.../[disputeId]/resolve/route.ts` |
| UI | `components/disputes/dispute-panel.tsx`, `components/admin/dispute-queue.tsx`, `app/admin/disputes/page.tsx` |
| Schema | `Dispute` model + partial unique index migration |
| Tests | `tests/dispute-policy.test.ts` — 37 cases |

## The decisions worth defending

**A dispute belongs to a vendor order, not an order.** An invoice can span two
stores. A complaint is always against one of them, and one store's failure says
nothing about the other's — so the refund ceiling, the commission at stake and the
payout at risk are all read from the vendor order, not the invoice total.

**The seven-day window is measured from delivery completion, not from checkout.**
A student cannot be timed out of complaining about a package that took five days to
arrive. `isWithinDisputeWindow` returns `false` for a `null` completion date, so a
purchase that never reached anyone is not disputable through this path at all — it
belongs to the delivery engine's own failure handling.

**One live case per vendor order, enforced in Postgres.** A partial unique index on
`(vendorOrderId)` `WHERE status IN ('OPEN','UNDER_REVIEW')` means two tabs cannot
open two cases against the same purchase. The service checks first for a decent
error message; the index is what makes the check true. A resolved case does not
block a new one, because a store that fails the same student twice has been
complained about twice.

**Refunds come out of the payout first, and the commission only after.** `attributeRefund`
splits a refund into `vendorBorneKobo` and `platformBorneKobo`: the vendor's payout
absorbs the refund up to its own size, and only what exceeds it touches the
platform's commission. The alternative — splitting proportionally — would have the
platform funding a refund for goods it never handled while the vendor keeps most of
its money.

**A partial refund is capped at the goods subtotal, not the order total.** The
delivery fee paid to an agent who did his job is not the vendor's to give back.
`resolveRefundAmount` rejects any amount above the goods subtotal and requires an
explicit amount for `PARTIAL_REFUND` — a partial refund with no number is not a
decision, it is an unfinished form.

**`refundCapacity` is checked against what the payment actually captured.** Not
against what the order said it should be. A payment that captured less than the
invoice — a provider partial capture — cannot be refunded beyond what arrived, and
the function reports `remainingAfterKobo` so a second dispute on the same payment
cannot quietly overdraw it.

**Resolution returns 200 even when the provider refuses the refund.** The decision
happened, the reasoning is recorded, and both parties were notified. What failed is
the money movement, and the response says so in `refund.succeeded` and
`refund.failureReason` so the admin sees "resolved, but the refund needs retrying"
rather than an error implying the whole decision was lost. Swallowing the failure
silently, or throwing away the resolution because a third party was down, would both
be worse.

**Every resolution requires a written explanation, minimum ten characters.** Both
the student and the vendor see it. A decision nobody explained cannot be reviewed by
the next admin, appealed by the student, or learned from by the vendor.

## A latent bug found and fixed

Regenerating the Prisma client after the schema change surfaced four notification
kinds that had rows in the enum but no renderer in `lib/notifications/messages.ts`.
The stale generated client had been masking them: the exhaustive `switch` was
checking against an out-of-date union, so TypeScript saw no missing arms. Those
notifications would have reached production as blank messages. Renderers added, and
the `notification-messages` suite now covers all sixteen.

The lesson is worth writing down: **`prisma generate` is part of verification, not
part of setup.** A typecheck against a stale client is a typecheck against last
week's schema.

## Verification

- `tsc --noEmit` — clean
- `eslint .` — clean
- `vitest run` — 244 tests, 16 files, all passing (37 new)
- `next build` — passing
- Both migrations applied to the dev database
