import { describe, expect, it } from "vitest";

import {
  CANCELLATION_REVIEW_THRESHOLD,
  CANCELLATION_WARNING_THRESHOLD,
  DELIVERY_TRANSITIONS,
  canTransition,
  deadlineFrom,
  escalationForCancellations,
  isActiveForAgent,
  isPastDeadline,
  isVisibleToLockedAgent,
  minutesRemaining,
} from "@/lib/delivery/rules";

/**
 * The delivery state machine (PRD §37–44).
 *
 * These are the rules the whole engine leans on, so they are tested directly
 * rather than through the database: if a forbidden jump ever becomes legal here,
 * it becomes legal everywhere.
 */
describe("delivery state machine", () => {
  it("only lets a package into the pool once its fee is settled", () => {
    expect(canTransition("AWAITING_DELIVERY_PAYMENT", "AVAILABLE")).toBe(true);
    expect(canTransition("AWAITING_DELIVERY_PAYMENT", "ACCEPTED")).toBe(false);
  });

  it("refuses to skip the pickup", () => {
    expect(canTransition("ACCEPTED", "PICKED_UP")).toBe(true);
    expect(canTransition("ACCEPTED", "ARRIVED")).toBe(false);
    expect(canTransition("ACCEPTED", "AWAITING_OTP")).toBe(false);
  });

  it("returns an accepted job to the pool but never a collected one", () => {
    // Before collection the package is still with the vendor, so re-offering it
    // is safe. After collection it is in the agent's hands and the only way out
    // is a hand-over or a return.
    expect(canTransition("ACCEPTED", "AVAILABLE")).toBe(true);
    expect(canTransition("PICKED_UP", "AVAILABLE")).toBe(false);
    expect(canTransition("IN_TRANSIT", "AVAILABLE")).toBe(false);
  });

  it("allows a return from every state where goods are in transit", () => {
    for (const status of ["PICKED_UP", "IN_TRANSIT", "ARRIVED"] as const) {
      expect(canTransition(status, "RETURNED")).toBe(true);
    }
  });

  it("treats completed, returned and cancelled as final", () => {
    for (const status of ["COMPLETED", "RETURNED", "CANCELLED"] as const) {
      expect(DELIVERY_TRANSITIONS[status]).toHaveLength(0);
    }
  });

  it("does not expose the OTP and payment steps to Phase 6 callers", () => {
    // Those transitions exist in the table for Phases 7–8, but nothing before
    // ARRIVED may reach them.
    expect(canTransition("IN_TRANSIT", "AWAITING_OTP")).toBe(false);
    expect(canTransition("ARRIVED", "COMPLETED")).toBe(false);
  });

  it("counts an agent as busy exactly while they hold goods or a claim", () => {
    expect(isActiveForAgent("ACCEPTED")).toBe(true);
    expect(isActiveForAgent("IN_TRANSIT")).toBe(true);
    expect(isActiveForAgent("AVAILABLE")).toBe(false);
    expect(isActiveForAgent("RETURNED")).toBe(false);
  });
});

describe("server-side deadlines", () => {
  const accepted = new Date("2026-08-15T10:00:00.000Z");

  it("puts the pickup deadline the configured number of minutes out", () => {
    expect(deadlineFrom(accepted, 15).toISOString()).toBe("2026-08-15T10:15:00.000Z");
  });

  it("expires only once the deadline is reached", () => {
    const deadline = deadlineFrom(accepted, 15);
    expect(isPastDeadline(deadline, new Date("2026-08-15T10:14:59.000Z"))).toBe(false);
    expect(isPastDeadline(deadline, new Date("2026-08-15T10:15:00.000Z"))).toBe(true);
  });

  it("never treats a missing deadline as expired", () => {
    // A null deadline means the state that sets one was never entered; reading
    // that as "expired" would cancel live work.
    expect(isPastDeadline(null, accepted)).toBe(false);
  });

  it("reports remaining minutes without going negative", () => {
    const deadline = deadlineFrom(accepted, 15);
    expect(minutesRemaining(deadline, accepted)).toBe(15);
    expect(minutesRemaining(deadline, new Date("2026-08-15T10:20:00.000Z"))).toBe(0);
  });
});

describe("destination lock", () => {
  it("offers the whole pool to a free agent", () => {
    expect(isVisibleToLockedAgent("hostel-b", null)).toBe(true);
  });

  it("offers a locked agent more work to the same destination", () => {
    // The point of the rule: one trip to Hostel B can serve several vendors.
    expect(isVisibleToLockedAgent("hostel-b", "hostel-b")).toBe(true);
  });

  it("hides work going anywhere else", () => {
    expect(isVisibleToLockedAgent("hostel-c", "hostel-b")).toBe(false);
  });
});

describe("repeated cancellation escalation (Rule 27)", () => {
  it("stays silent below the warning threshold", () => {
    expect(escalationForCancellations(CANCELLATION_WARNING_THRESHOLD - 1)).toBe("NONE");
  });

  it("warns at the warning threshold", () => {
    expect(escalationForCancellations(CANCELLATION_WARNING_THRESHOLD)).toBe("WARNING");
  });

  it("flags for admin review at the review threshold and beyond", () => {
    expect(escalationForCancellations(CANCELLATION_REVIEW_THRESHOLD)).toBe("REVIEW");
    expect(escalationForCancellations(CANCELLATION_REVIEW_THRESHOLD + 10)).toBe("REVIEW");
  });
});
