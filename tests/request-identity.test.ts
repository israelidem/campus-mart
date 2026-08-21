import { describe, expect, it } from "vitest";

import { clientIp, normaliseIp } from "@/lib/security/request-identity";

/**
 * Request identity (Phase 13).
 *
 * An IP address becomes a rate-limit key, so these tests are really about key
 * hygiene: two spellings of one address must not be two keys, an attacker must not
 * be able to invent unlimited keys, and a forged header must not outrank one the
 * platform set itself.
 */

describe("header precedence", () => {
  it("prefers the platform's own header over one a client can forge", () => {
    const headers = new Headers({
      "x-vercel-forwarded-for": "203.0.113.7",
      // A client can send whatever it likes here. If this won, a single attacker
      // could rotate through a new key per request and never meet a limit.
      "x-forwarded-for": "198.51.100.1",
    });

    expect(clientIp(headers)).toBe("203.0.113.7");
  });

  it("falls back through the chain when the trusted headers are absent", () => {
    expect(clientIp(new Headers({ "cf-connecting-ip": "203.0.113.8" }))).toBe("203.0.113.8");
    expect(clientIp(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.10" }))).toBe("203.0.113.10");
  });

  it("takes the left-most entry of a proxy chain", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178",
    });

    expect(clientIp(headers)).toBe("203.0.113.7");
  });

  it("skips junk entries in a chain rather than keying on them", () => {
    const headers = new Headers({ "x-forwarded-for": "unknown, , 203.0.113.7" });

    expect(clientIp(headers)).toBe("203.0.113.7");
  });

  it("returns null rather than a placeholder when no address can be established", () => {
    // A shared "unknown" bucket would let one header-stripping attacker exhaust the
    // allowance of every other caller whose address is also unknown.
    expect(clientIp(new Headers())).toBeNull();
    expect(clientIp(new Headers({ "x-forwarded-for": "not-an-ip" }))).toBeNull();
  });

  it("reads plain objects as well as Headers, so it can be called off a raw request", () => {
    expect(clientIp({ "x-real-ip": "203.0.113.7" })).toBe("203.0.113.7");
    // Node's `IncomingHttpHeaders` gives an array when a header repeats.
    expect(clientIp({ "x-real-ip": ["203.0.113.7", "198.51.100.1"] })).toBe("203.0.113.7");
    expect(clientIp({ "x-real-ip": undefined })).toBeNull();
  });
});

describe("normalising an address", () => {
  it("accepts a plain IPv4 address", () => {
    expect(normaliseIp("203.0.113.7")).toBe("203.0.113.7");
    expect(normaliseIp("  203.0.113.7  ")).toBe("203.0.113.7");
  });

  it("strips a port from IPv4 but leaves IPv6 colons alone", () => {
    expect(normaliseIp("203.0.113.7:54321")).toBe("203.0.113.7");
    expect(normaliseIp("2001:db8::1")).toBe("2001:db8::1");
  });

  it("unwraps bracketed IPv6, with or without a port", () => {
    expect(normaliseIp("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(normaliseIp("[2001:db8::1]")).toBe("2001:db8::1");
  });

  it("folds an IPv4-mapped IPv6 address to its IPv4 form", () => {
    // The same phone must not occupy two buckets because a proxy spelled its
    // address differently on the second request.
    expect(normaliseIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(normaliseIp("::FFFF:203.0.113.7")).toBe("203.0.113.7");
  });

  it("lower-cases IPv6 so one address is one key", () => {
    expect(normaliseIp("2001:DB8::AB")).toBe("2001:db8::ab");
  });

  it("rejects leading-zero octets, which are a second spelling of one address", () => {
    expect(normaliseIp("203.0.113.007")).toBeNull();
    expect(normaliseIp("01.2.3.4")).toBeNull();
  });

  it("rejects out-of-range and malformed IPv4", () => {
    expect(normaliseIp("203.0.113.256")).toBeNull();
    expect(normaliseIp("203.0.113")).toBeNull();
    expect(normaliseIp("203.0.113.7.8")).toBeNull();
  });

  it("rejects malformed IPv6", () => {
    expect(normaliseIp("2001:db8::1::2")).toBeNull();
    expect(normaliseIp("2001:::1")).toBeNull();
    expect(normaliseIp("2001:db8:1:2:3:4:5:6:7:8:9")).toBeNull();
  });

  it("rejects anything that is not an address at all", () => {
    // An attacker who controls the header controls the key, and an unbounded key
    // space is a way to write unbounded rows.
    expect(normaliseIp("")).toBeNull();
    expect(normaliseIp("   ")).toBeNull();
    expect(normaliseIp("unknown")).toBeNull();
    expect(normaliseIp("localhost")).toBeNull();
    expect(normaliseIp("'; DROP TABLE users; --")).toBeNull();
    expect(normaliseIp("a".repeat(500))).toBeNull();
  });

  it("rejects an over-long IPv6-looking string", () => {
    expect(normaliseIp(`${"2001:db8:".repeat(20)}1`)).toBeNull();
  });

  it("keeps loopback and private addresses, which are real in development", () => {
    expect(normaliseIp("127.0.0.1")).toBe("127.0.0.1");
    expect(normaliseIp("::1")).toBe("::1");
    expect(normaliseIp("192.168.1.10")).toBe("192.168.1.10");
  });
});
