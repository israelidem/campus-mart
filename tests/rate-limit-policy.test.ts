import { describe, expect, it } from "vitest";

import {
  RATE_LIMITS,
  evaluate,
  expiresAt,
  rateLimitKey,
  secondsUntil,
  windowEndsAt,
  windowIndex,
  windowStartedAt,
} from "@/lib/security/rate-limit-policy";

/**
 * Rate-limit policy (Phase 13).
 *
 * These assertions are about the boundaries, not about the numbers. A test that
 * restates `RATE_LIMITS.DISPUTE_FILING.limit === 10` proves only that a constant is
 * a constant; the interesting questions are whether the limit is off by one, whether
 * a window is inclusive at both ends, and whether `Retry-After` can be zero.
 */

const WINDOW = 600; // ten minutes, the hand-over window

describe("window arithmetic", () => {
  it("puts the first millisecond of a window in that window and the last in the same one", () => {
    const start = new Date("2026-08-21T10:00:00.000Z");
    const lastMs = new Date("2026-08-21T10:09:59.999Z");

    expect(windowIndex(start, WINDOW)).toBe(windowIndex(lastMs, WINDOW));
  });

  it("moves to the next window exactly on the boundary, not a millisecond before", () => {
    const lastMs = new Date("2026-08-21T10:09:59.999Z");
    const boundary = new Date("2026-08-21T10:10:00.000Z");

    // The boundary belongs to the next window: a half-open range, like every other
    // range on the platform. If it belonged to both, one request would spend two
    // allowances.
    expect(windowIndex(boundary, WINDOW)).toBe(windowIndex(lastMs, WINDOW) + 1);
  });

  it("reports a window's start as inclusive and its end as exclusive", () => {
    const now = new Date("2026-08-21T10:03:27.412Z");

    expect(windowStartedAt(now, WINDOW).toISOString()).toBe("2026-08-21T10:00:00.000Z");
    expect(windowEndsAt(now, WINDOW).toISOString()).toBe("2026-08-21T10:10:00.000Z");
  });

  it("aligns windows to the epoch rather than to first use", () => {
    // Two callers who first appear at different moments must share a window, or a
    // limit would mean something different for each of them.
    const early = new Date("2026-08-21T10:00:01.000Z");
    const late = new Date("2026-08-21T10:09:00.000Z");

    expect(windowStartedAt(early, WINDOW).getTime()).toBe(windowStartedAt(late, WINDOW).getTime());
  });

  it("refuses a window that is not a positive number of seconds", () => {
    const now = new Date("2026-08-21T10:00:00.000Z");

    expect(() => windowIndex(now, 0)).toThrow(/positive/i);
    expect(() => windowIndex(now, -60)).toThrow(/positive/i);
    expect(() => windowIndex(now, Number.NaN)).toThrow(/positive/i);
  });
});

describe("counter keys", () => {
  it("separates action, scope and identifier so budgets never bleed into each other", () => {
    const now = new Date("2026-08-21T10:00:00.000Z");
    const base = { identifier: "user_1", now } as const;

    const issue = rateLimitKey({ ...base, action: "HANDOVER_CODE_ISSUE", scope: "user" });
    const verify = rateLimitKey({ ...base, action: "HANDOVER_CODE_VERIFY", scope: "user" });
    const byIp = rateLimitKey({ ...base, action: "HANDOVER_CODE_ISSUE", scope: "ip" });
    const otherUser = rateLimitKey({
      action: "HANDOVER_CODE_ISSUE",
      scope: "user",
      identifier: "user_2",
      now,
    });

    expect(new Set([issue, verify, byIp, otherUser]).size).toBe(4);
  });

  it("changes the key when the window rolls, so a new window is a new row", () => {
    const inWindow = new Date("2026-08-21T10:09:59.999Z");
    const nextWindow = new Date("2026-08-21T10:10:00.000Z");
    const args = { action: "HANDOVER_CODE_ISSUE", scope: "user", identifier: "user_1" } as const;

    // This is what lets the limiter be a single atomic upsert: nothing ever has to
    // decide whose job it is to reset a counter to zero.
    expect(rateLimitKey({ ...args, now: inWindow })).not.toBe(
      rateLimitKey({ ...args, now: nextWindow }),
    );
  });

  it("keeps the key stable for every moment inside one window", () => {
    const args = { action: "PAYMENT_INITIATION", scope: "ip", identifier: "203.0.113.7" } as const;

    expect(rateLimitKey({ ...args, now: new Date("2026-08-21T10:00:00.000Z") })).toBe(
      rateLimitKey({ ...args, now: new Date("2026-08-21T10:09:59.999Z") }),
    );
  });
});

describe("evaluating a counter", () => {
  const now = new Date("2026-08-21T10:00:00.000Z");

  it("allows the attempt that reaches the limit and refuses the one after it", () => {
    const limit = RATE_LIMITS.HANDOVER_CODE_VERIFY.limit;

    // `hits` is the count *including* this attempt, so hits === limit is the last
    // allowed one. Off by one here would either give away a free attempt or steal
    // the user's last legitimate one.
    expect(evaluate({ action: "HANDOVER_CODE_VERIFY", hits: limit, now }).allowed).toBe(true);
    expect(evaluate({ action: "HANDOVER_CODE_VERIFY", hits: limit + 1, now }).allowed).toBe(false);
  });

  it("counts down remaining attempts and stops at zero rather than going negative", () => {
    const limit = RATE_LIMITS.DISPUTE_FILING.limit;

    expect(evaluate({ action: "DISPUTE_FILING", hits: 1, now }).remaining).toBe(limit - 1);
    expect(evaluate({ action: "DISPUTE_FILING", hits: limit, now }).remaining).toBe(0);
    // A hammering client must not be told it has -40 attempts left.
    expect(evaluate({ action: "DISPUTE_FILING", hits: limit + 40, now }).remaining).toBe(0);
  });

  it("never advises a client to retry in zero seconds", () => {
    // One millisecond before the window resets, rounding down would produce 0 and a
    // client honouring `Retry-After: 0` would retry immediately and be refused again.
    const almostOver = new Date(windowEndsAt(now, 600).getTime() - 1);

    const decision = evaluate({ action: "HANDOVER_CODE_ISSUE", hits: 99, now: almostOver });

    expect(decision.retryAfterSeconds).toBe(1);
  });

  it("reports a retry no later than the window it belongs to", () => {
    const decision = evaluate({ action: "STUDENT_REGISTRATION", hits: 99, now });

    expect(decision.retryAfterSeconds).toBeLessThanOrEqual(
      RATE_LIMITS.STUDENT_REGISTRATION.windowSeconds,
    );
  });

  it("reports the limit it judged against, so the caller can say so in a header", () => {
    expect(evaluate({ action: "DOCUMENT_UPLOAD", hits: 1, now }).limit).toBe(
      RATE_LIMITS.DOCUMENT_UPLOAD.limit,
    );
  });
});

describe("secondsUntil", () => {
  it("rounds part-seconds up, because rounding down tells a client to retry too early", () => {
    const now = new Date("2026-08-21T10:00:00.000Z");

    expect(secondsUntil(now, new Date("2026-08-21T10:00:01.001Z"))).toBe(2);
  });

  it("returns at least one second for a target already in the past", () => {
    const now = new Date("2026-08-21T10:00:00.000Z");

    expect(secondsUntil(now, new Date("2026-08-21T09:59:00.000Z"))).toBe(1);
  });
});

describe("row expiry", () => {
  it("expires a counter exactly when its window ends", () => {
    const now = new Date("2026-08-21T10:03:00.000Z");

    // Not "now + window": that would keep a row alive past the window it counts,
    // and the sweep would leave rows that can never be read again.
    expect(expiresAt(now, "HANDOVER_CODE_VERIFY").getTime()).toBe(
      windowEndsAt(now, RATE_LIMITS.HANDOVER_CODE_VERIFY.windowSeconds).getTime(),
    );
  });
});

describe("the limits themselves", () => {
  it("gives every action a positive limit and a positive window", () => {
    for (const [action, rule] of Object.entries(RATE_LIMITS)) {
      expect(rule.limit, `${action} limit`).toBeGreaterThan(0);
      expect(rule.windowSeconds, `${action} window`).toBeGreaterThan(0);
    }
  });

  it("allows more code submissions than a single code permits", () => {
    // The per-code lock is five attempts. If the rate limit were tighter than that,
    // it would be the thing that stopped honest students, not the thing that stopped
    // an agent rotating through codes.
    expect(RATE_LIMITS.HANDOVER_CODE_VERIFY.limit).toBeGreaterThan(5);
  });

  it("does not let code issuing be looser than code verification", () => {
    // Issuing resets the per-code attempt counter, so a generous issue budget
    // reopens the guessing surface the verify budget exists to close.
    expect(RATE_LIMITS.HANDOVER_CODE_ISSUE.limit).toBeLessThanOrEqual(
      RATE_LIMITS.HANDOVER_CODE_VERIFY.limit,
    );
  });

  it("keeps payment verification looser than payment initiation", () => {
    // Verification is a read the client polls after returning from checkout;
    // initiation writes a row and spends provider quota.
    expect(RATE_LIMITS.PAYMENT_VERIFICATION.limit).toBeGreaterThan(
      RATE_LIMITS.PAYMENT_INITIATION.limit,
    );
  });
});
