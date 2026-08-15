import { describe, expect, it } from "vitest";

import {
  attemptsRemaining,
  checkOtpUsable,
  generateHandoverCode,
  hashHandoverCode,
  hashesMatch,
  isWellFormedHandoverCode,
  MAX_OTP_ATTEMPTS,
  normaliseHandoverCode,
  OTP_LENGTH,
} from "@/lib/delivery/otp";

/**
 * The hand-over code is the control that stands between a delivery agent and
 * someone else's money (PRD §45–46), so these tests are about the properties
 * that make it safe rather than about a happy path.
 */

const secret = "test-secret-value-not-a-real-one";

describe("generateHandoverCode", () => {
  it("always produces exactly six digits, leading zeros included", () => {
    for (let i = 0; i < 500; i += 1) {
      const code = generateHandoverCode();
      expect(code).toHaveLength(OTP_LENGTH);
      expect(isWellFormedHandoverCode(code)).toBe(true);
    }
  });

  it("does not repeat itself in a short run", () => {
    // Not a randomness proof — a guard against someone replacing the CSPRNG
    // with something derived from the clock or the delivery id.
    const codes = new Set(Array.from({ length: 200 }, () => generateHandoverCode()));
    expect(codes.size).toBeGreaterThan(150);
  });
});

describe("normaliseHandoverCode", () => {
  it("ignores the spacing a student reads the code out with", () => {
    expect(normaliseHandoverCode("482 917")).toBe("482917");
    expect(normaliseHandoverCode("482-917")).toBe("482917");
  });
});

describe("hashHandoverCode", () => {
  it("is stable for the same code, delivery and secret", () => {
    const a = hashHandoverCode({ code: "123456", deliveryId: "d1", secret });
    const b = hashHandoverCode({ code: "123 456", deliveryId: "d1", secret });
    expect(a).toBe(b);
  });

  it("never stores the code itself", () => {
    const hash = hashHandoverCode({ code: "123456", deliveryId: "d1", secret });
    expect(hash).not.toContain("123456");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is bound to the delivery, so a hash cannot be replayed elsewhere", () => {
    expect(hashHandoverCode({ code: "123456", deliveryId: "d1", secret })).not.toBe(
      hashHandoverCode({ code: "123456", deliveryId: "d2", secret }),
    );
  });

  it("is bound to the secret", () => {
    expect(hashHandoverCode({ code: "123456", deliveryId: "d1", secret })).not.toBe(
      hashHandoverCode({ code: "123456", deliveryId: "d1", secret: "another-secret" }),
    );
  });
});

describe("hashesMatch", () => {
  it("accepts identical digests and rejects different ones", () => {
    const hash = hashHandoverCode({ code: "123456", deliveryId: "d1", secret });
    expect(hashesMatch(hash, hash)).toBe(true);
    expect(
      hashesMatch(hash, hashHandoverCode({ code: "123457", deliveryId: "d1", secret })),
    ).toBe(false);
  });

  it("rejects an empty or malformed stored hash instead of matching it", () => {
    // The service passes `otpHash ?? ""` when no code was ever issued; that must
    // never compare equal to a submitted code.
    expect(hashesMatch("", "")).toBe(false);
    expect(hashesMatch("not-hex", "not-hex")).toBe(false);
  });
});

describe("checkOtpUsable", () => {
  const now = new Date("2026-08-15T18:00:00.000Z");
  const later = new Date("2026-08-15T18:10:00.000Z");

  const issued = {
    hash: "a".repeat(64),
    expiresAt: later,
    attemptCount: 0,
    verifiedAt: null as Date | null,
  };

  it("allows a fresh code", () => {
    expect(checkOtpUsable(issued, now)).toEqual({ ok: true });
  });

  it("refuses when no code has been issued", () => {
    expect(checkOtpUsable({ ...issued, hash: null }, now)).toEqual({
      ok: false,
      reason: "NOT_ISSUED",
    });
  });

  it("refuses a code that has already been used", () => {
    expect(checkOtpUsable({ ...issued, verifiedAt: now }, now)).toEqual({
      ok: false,
      reason: "ALREADY_VERIFIED",
    });
  });

  it("refuses once the window has closed, judged by the server clock", () => {
    expect(checkOtpUsable({ ...issued, expiresAt: now }, now)).toEqual({
      ok: false,
      reason: "EXPIRED",
    });
    expect(checkOtpUsable(issued, later)).toEqual({ ok: false, reason: "EXPIRED" });
  });

  it("locks after the allowed number of wrong tries", () => {
    expect(checkOtpUsable({ ...issued, attemptCount: MAX_OTP_ATTEMPTS - 1 }, now)).toEqual({
      ok: true,
    });
    expect(checkOtpUsable({ ...issued, attemptCount: MAX_OTP_ATTEMPTS }, now)).toEqual({
      ok: false,
      reason: "LOCKED",
    });
  });

  it("treats a used code as used even when it is also expired", () => {
    // Order matters: "already confirmed" is the truthful answer, and it stops the
    // agent being told to ask for a new code after a successful hand-over.
    expect(checkOtpUsable({ ...issued, verifiedAt: now, expiresAt: now }, later)).toEqual({
      ok: false,
      reason: "ALREADY_VERIFIED",
    });
  });
});

describe("attemptsRemaining", () => {
  it("counts down and never goes negative", () => {
    expect(attemptsRemaining(0)).toBe(MAX_OTP_ATTEMPTS);
    expect(attemptsRemaining(MAX_OTP_ATTEMPTS)).toBe(0);
    expect(attemptsRemaining(MAX_OTP_ATTEMPTS + 3)).toBe(0);
  });
});
