import { describe, expect, it } from "vitest";

import { secretsMatch } from "@/lib/security/secrets";

/**
 * Secret comparison (Phase 13).
 *
 * The timing property itself cannot be asserted in a unit test — measuring it
 * reliably needs thousands of samples and a quiet machine, and a flaky security test
 * gets deleted. What can be asserted is the behaviour a timing-safe comparison must
 * still get right, and the two cases that turn one into a hole: differing lengths
 * (`timingSafeEqual` throws rather than returning false) and empty values (an unset
 * secret must never match an absent header).
 */

describe("secretsMatch", () => {
  const secret = "s3cr3t-cron-token-with-enough-entropy";

  it("matches an identical secret", () => {
    expect(secretsMatch(secret, secret)).toBe(true);
  });

  it("does not match a different secret of the same length", () => {
    const wrong = `${secret.slice(0, -1)}X`;

    expect(wrong.length).toBe(secret.length);
    expect(secretsMatch(wrong, secret)).toBe(false);
  });

  it("returns false for differing lengths instead of throwing", () => {
    // `timingSafeEqual` throws on length mismatch. Unguarded, that would surface as
    // a 500 from the cron route — which tells an attacker their guess was the wrong
    // *length*, and turns a wrong guess into a crash.
    expect(() => secretsMatch("short", secret)).not.toThrow();
    expect(secretsMatch("short", secret)).toBe(false);
    expect(secretsMatch(`${secret}extra`, secret)).toBe(false);
  });

  it("never matches when either side is empty", () => {
    // The important one: an unset `CRON_SECRET` compared with an absent header must
    // not be "equal". A missing configuration would otherwise be an open endpoint.
    expect(secretsMatch("", "")).toBe(false);
    expect(secretsMatch(null, secret)).toBe(false);
    expect(secretsMatch(undefined, secret)).toBe(false);
    expect(secretsMatch("", secret)).toBe(false);
    expect(secretsMatch(secret, "")).toBe(false);
  });

  it("is exact rather than lenient about whitespace and case", () => {
    expect(secretsMatch(` ${secret}`, secret)).toBe(false);
    expect(secretsMatch(secret.toUpperCase(), secret)).toBe(false);
  });

  it("compares bytes, so a prefix of the secret is not a match", () => {
    expect(secretsMatch(secret.slice(0, 10), secret)).toBe(false);
  });

  it("handles multi-byte characters without mismatching a value against itself", () => {
    // Buffer lengths differ from string lengths here; comparing by character count
    // would either throw or compare the wrong number of bytes.
    const unicode = "clé-secrète-🔐";

    expect(secretsMatch(unicode, unicode)).toBe(true);
    expect(secretsMatch("clé-secrète-🔓", unicode)).toBe(false);
  });
});
