/**
 * Who is calling, as far as the network can tell (Phase 13).
 *
 * Pure: it reads headers and returns a string. No Prisma, no clock, no request
 * object, so it can be tested against the exact header shapes each host sends.
 *
 * An IP address is a weak identity — a campus behind one NAT shares it, a phone
 * changes it between the hostel and the lecture hall — which is why every limit
 * that can also be keyed by user id is keyed by both. It is used here for the one
 * case a user id cannot cover: an attacker who has not signed in yet.
 */

type HeaderSource = Headers | Record<string, string | string[] | undefined>;

function read(headers: HeaderSource, name: string): string | null {
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name);
  }
  const value = (headers as Record<string, string | string[] | undefined>)[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Headers in order of trustworthiness on this platform.
 *
 * `x-vercel-forwarded-for` is set by Vercel's edge from the connection it
 * actually terminated, so a client cannot forge it. `x-real-ip` is next.
 * `x-forwarded-for` is last because any client may send it: behind a proxy it is
 * appended to, and the left-most entry is whatever the client claimed.
 */
const CANDIDATE_HEADERS = [
  "x-vercel-forwarded-for",
  "cf-connecting-ip",
  "x-real-ip",
  "x-forwarded-for",
] as const;

/**
 * The caller's IP, or null when it cannot be established.
 *
 * Null is returned rather than a placeholder such as "unknown" on purpose: a
 * shared placeholder is a shared bucket, and one attacker stripping headers
 * would then exhaust the allowance for every request whose IP is also unknown.
 * The caller decides what to do with null (see `lib/security/rate-limit.ts`,
 * which skips that scope and says so in the log).
 */
export function clientIp(headers: HeaderSource): string | null {
  for (const name of CANDIDATE_HEADERS) {
    const raw = read(headers, name);
    if (!raw) continue;

    // `x-forwarded-for: client, proxy1, proxy2` — the left-most entry is the
    // original client. On Vercel the platform rewrites this header, so trusting
    // the left-most entry is correct there; on a self-hosted proxy that appends
    // without stripping, it is the value to fix in the proxy, not here.
    for (const candidate of raw.split(",")) {
      const normalised = normaliseIp(candidate);
      if (normalised) return normalised;
    }
  }
  return null;
}

/**
 * Trims, unwraps and validates an address.
 *
 * Anything that is not recognisably an IPv4 or IPv6 address is rejected instead
 * of being used as a key, because an attacker who controls the header controls
 * the key, and an unbounded key space is a way to write unbounded rows.
 */
export function normaliseIp(value: string): string | null {
  let candidate = value.trim();
  if (!candidate) return null;

  // `[2001:db8::1]:443` — bracketed IPv6 with a port.
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(candidate);
  if (bracketed?.[1]) candidate = bracketed[1];

  // `203.0.113.7:54321` — IPv4 with a port. Only stripped when the remainder is
  // a plain IPv4 address, so an IPv6 address's own colons are left alone.
  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(candidate);
  if (withPort?.[1]) candidate = withPort[1];

  // IPv4-mapped IPv6 (`::ffff:203.0.113.7`) is folded to its IPv4 form so the
  // same client is not counted twice under two spellings.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(candidate);
  if (mapped?.[1]) candidate = mapped[1];

  if (isIpv4(candidate)) return candidate;
  if (isIpv6(candidate)) return candidate.toLowerCase();
  return null;
}

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    // "01" and "007" are rejected: two spellings of one address are two keys.
    if (part.length > 1 && part.startsWith("0")) return false;
    return Number(part) <= 255;
  });
}

function isIpv6(value: string): boolean {
  if (!value.includes(":")) return false;
  if (value.length > 45) return false;
  if (!/^[0-9a-f:.]+$/i.test(value)) return false;
  // At most one "::" run, and never three colons together.
  if (value.includes(":::")) return false;
  const doubleColons = value.split("::").length - 1;
  if (doubleColons > 1) return false;
  const groups = value.split(":").filter(Boolean);
  return groups.length > 0 && groups.length <= 8;
}
