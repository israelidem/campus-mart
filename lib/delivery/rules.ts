import type { DeliveryStatus } from "@/lib/generated/prisma/enums";

/**
 * The delivery state machine and its timing rules (PRD §37–44).
 *
 * Deliberately pure: no Prisma, no clock of its own, no request context. The
 * service layer owns transactions and reads the current row; this module owns
 * *what is allowed*, so the rules can be tested exhaustively without a database
 * and cannot drift between the pool query, the API and the UI.
 */

/**
 * Which states each state may move to.
 *
 * Read the table as the journey: a package waits for the delivery fee, enters
 * the pool, is claimed, collected, carried, and handed over. Every arrow that is
 * missing is a rule: an ACCEPTED delivery cannot jump to ARRIVED without a
 * pickup, and a RETURNED one cannot come back to life.
 *
 * AWAITING_OTP, PAYMENT_PENDING and COMPLETED belong to Phases 7–8. ARRIVED
 * therefore has no forward transition here yet — Phase 6 ends the journey at
 * the destination, either by waiting (Phase 7 takes over) or by returning the
 * goods when the student never shows (PRD §44).
 */
export const DELIVERY_TRANSITIONS: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  AWAITING_DELIVERY_PAYMENT: ["AVAILABLE", "CANCELLED"],
  AVAILABLE: ["ACCEPTED", "CANCELLED"],
  // Back to AVAILABLE covers both a pickup expiry and an agent cancellation.
  ACCEPTED: ["PICKED_UP", "AVAILABLE", "CANCELLED"],
  PICKED_UP: ["IN_TRANSIT", "RETURNED"],
  IN_TRANSIT: ["ARRIVED", "RETURNED"],
  ARRIVED: ["AWAITING_OTP", "RETURNED"],
  AWAITING_OTP: ["PAYMENT_PENDING", "RETURNED"],
  PAYMENT_PENDING: ["COMPLETED", "RETURNED"],
  COMPLETED: [],
  RETURNED: [],
  CANCELLED: [],
};

export function allowedTransitions(from: DeliveryStatus): readonly DeliveryStatus[] {
  return DELIVERY_TRANSITIONS[from] ?? [];
}

export function canTransition(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return allowedTransitions(from).includes(to);
}


/** States in which an agent is still carrying work and is destination-locked. */
export const ACTIVE_AGENT_STATUSES: readonly DeliveryStatus[] = [
  "ACCEPTED",
  "PICKED_UP",
  "IN_TRANSIT",
  "ARRIVED",
  "AWAITING_OTP",
  "PAYMENT_PENDING",
];

export function isActiveForAgent(status: DeliveryStatus): boolean {
  return ACTIVE_AGENT_STATUSES.includes(status);
}

/** `from` + `minutes`, as a deadline the server stores and later compares. */
export function deadlineFrom(from: Date, minutes: number): Date {
  return new Date(from.getTime() + minutes * 60_000);
}

/**
 * Whether a stored deadline has passed.
 *
 * A null deadline is never expired: it means the state that would have set one
 * was never entered, and treating "unknown" as "expired" would silently cancel
 * live work.
 */
export function isPastDeadline(deadline: Date | null | undefined, now: Date): boolean {
  if (!deadline) return false;
  return deadline.getTime() <= now.getTime();
}

/** Whole minutes left, floored at zero, for display only. */
export function minutesRemaining(deadline: Date | null | undefined, now: Date): number {
  if (!deadline) return 0;
  return Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / 60_000));
}

/**
 * Destination locking (PRD §43).
 *
 * An agent already carrying a package to Hostel B may pick up further jobs going
 * to Hostel B — that is the point of the rule, it lets one trip serve several
 * vendors — but jobs going anywhere else are hidden until they are free again.
 * A null lock means the agent is carrying nothing, so the whole pool is theirs.
 */
export function isVisibleToLockedAgent(
  jobDestinationLocationId: string,
  lockedDestinationLocationId: string | null,
): boolean {
  if (!lockedDestinationLocationId) return true;
  return jobDestinationLocationId === lockedDestinationLocationId;
}

/**
 * Escalation for repeated agent cancellations (PRD §42, Rule 27).
 *
 * Counted per agent over the life of the account, not per day: the rule exists
 * to surface unreliable agents to an admin, and a rolling window would let a
 * steady trickle of abandonment go unnoticed. The thresholds are constants
 * rather than campus settings because Rule 27 is platform policy — a campus can
 * suspend an agent sooner by hand, but it cannot opt out of the escalation.
 */
export const CANCELLATION_WARNING_THRESHOLD = 3;
export const CANCELLATION_REVIEW_THRESHOLD = 5;

export type CancellationEscalation = "NONE" | "WARNING" | "REVIEW";

export function escalationForCancellations(count: number): CancellationEscalation {
  if (count >= CANCELLATION_REVIEW_THRESHOLD) return "REVIEW";
  if (count >= CANCELLATION_WARNING_THRESHOLD) return "WARNING";
  return "NONE";
}
