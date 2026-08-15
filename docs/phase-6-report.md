# Phase 6 — Delivery engine

Scope from the PRD: delivery agents, the campus delivery pool, atomic assignment,
the 15-minute pickup rule, the destination lock, agent cancellations with
escalation, and returns when a student never shows.

## What was built

**Schema** (`prisma/migrations/20260815*_phase_6_delivery_engine`)

- `DeliveryAgentProfile` — one per user per campus, with `status`
  (`VerificationStatus`), `isOnDuty`, `phone`, `cancellationCount`, `warnedAt`,
  `underReviewAt` and the admin's `reviewNote`.
- `Delivery` — one per `VendorOrder` (unique), carrying `campusId`, the pickup
  and destination snapshots, the contact numbers, `orderDeliveryFeeKobo`, the
  assigned agent, and the server-set `pickupDeadline` / `waitDeadline`.
- `DeliveryEvent` — an append-only trail of every transition.
- `CampusSettings.pickupWindowMinutes` / `studentWaitMinutes` — the two timers,
  per campus, defaulting to the PRD's 15 and 10.

**Rules** (`lib/delivery/rules.ts`) — the transition table, deadline arithmetic,
the destination-lock predicate and Rule 27's escalation thresholds, all pure and
unit-tested.

**Services**

- `lib/delivery/agent-service.ts` — apply, resubmit, duty toggle, admin review
  (approve / reject / request correction / suspend / reinstate), and
  `requireApprovedAgent`, which is the single gate every delivery operation goes
  through.
- `lib/delivery/delivery-service.ts` — `createDeliveryForVendorOrder`,
  `publishDeliveriesForPaidOrder`, `listPool`, `listMyDeliveries`,
  `acceptDelivery`, `progressDelivery`, `cancelByAgent`,
  `reportStudentUnavailable`, `expirePickups`, and the student-facing
  `listDeliveriesForStudentOrder`.

**API** — `/api/agents/me`, `/api/admin/agents[/:id]`, `/api/deliveries/pool`,
`/api/deliveries/mine`, `/api/deliveries/:id` (progress),
`/api/deliveries/:id/accept`, `/api/deliveries/:id/cancel`,
`/api/deliveries/:id/unavailable`.

**UI** — `app/agent` (apply, duty switch, pool, own deliveries) and
`app/admin/agents` (review queue, with flagged agents surfaced).

## Decisions worth knowing

**Assignment is one conditional update.** `acceptDelivery` claims with
`updateMany(where: { id, status: AVAILABLE, agentProfileId: null })`. Two agents
tapping at the same instant both run it; exactly one gets `count === 1` and the
other is told the job is gone. No read-then-write window, no lock, no dependence
on arrival order.

**Deadlines live on the server.** `pickupDeadline` and `waitDeadline` are written
when the state that starts them is entered, and compared against the server's
clock. A late `PICKED_UP` does not merely fail — it releases the delivery back to
the pool, so a silent agent cannot keep a package hidden.

**Expiry runs without a scheduler.** `expirePickups` is a sweep a cron can call,
and `listPool` also calls it for the reading agent's campus. That is what makes
the 15-minute rule real in an environment with no background worker yet.

**A delivery is created by the vendor's own transition.** Marking a slice
`READY_FOR_PICKUP` creates its delivery in the same transaction, so a ready
package always has a delivery row. If the delivery fee is not yet paid the row
starts `AWAITING_DELIVERY_PAYMENT` and is invisible to agents;
`publishDeliveriesForPaidOrder` is the seam Phase 8's webhook calls to release
it. Nothing in the product can declare a payment successful.

**Cancellation escalates, it does not punish.** The counter is incremented in the
same transaction as the release; the second cancellation warns, the third flags
the agent for admin review and takes them off duty. Suspension stays a human
decision.

**A return puts the goods back.** `reportStudentUnavailable` cancels the vendor
slice, restores every reserved unit with a `RETURN` inventory transaction, and
cancels the invoice only when no slice survives. The delivery fee is not refunded
(PRD §44); settling what was already paid belongs to Phase 8.

**Contact details follow the assignment.** The pool advertises pickup, destination
and fee. The student's phone number and delivery note are only returned to the
one agent carrying the package.

## Verification

- `npm run test` → 127 tests / 11 files pass, including 17 new state-machine,
  deadline, destination-lock and escalation tests.
- `npm run lint` and `npm run build` clean.

## Left for later phases

- OTP hand-over and the goods-payment unlock (Phase 7). `AWAITING_OTP` and
  `COMPLETED` exist in the transition table but nothing in Phase 6 can reach
  them: `ARRIVED` is where this phase stops.
- Delivery-fee and goods payments, and refunds for a returned order (Phase 8).
- Notifying an agent that a job appeared, or a student that their agent arrived
  (Phase 9); today both sides see it on refresh.
- Agent earnings and ratings (Phases 8, 10).
