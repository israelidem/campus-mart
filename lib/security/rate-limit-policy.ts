/**
 * Rate-limit policy (Phase 13, PRD Part X).
 *
 * Pure and clock-free, like `lib/delivery/otp.ts` and `lib/ratings/rating-policy.ts`:
 * this module decides *what* a limit is and *whether* a counter has exceeded it.
 * It knows nothing about Prisma, requests or headers. The store and the clock are
 * the caller's problem, which is what makes the window arithmetic testable at the
 * millisecond boundary.
 *
 * The scheme is a **fixed window**, deliberately, not a sliding one:
 *
 * - A fixed window can be keyed by its own index, so the counter row's identity
 *   already encodes the window it belongs to. Incrementing is then a single
 *   atomic upsert with no read-modify-write, which is the only way a limiter
 *   backed by Postgres stays correct across serverless instances.
 * - Its known weakness is the boundary: an attacker can spend a full window's
 *   allowance at the end of one window and again at the start of the next. For
 *   the things being protected here — six-digit codes, sign-ups, payment
 *   initiations — twice the limit for one instant is still orders of magnitude
 *   away from a successful brute force, and the alternative (a sorted set of
 *   timestamps per key) costs a read and a write per request.
 */

/** One limit: how many attempts, over how long. */
export type RateLimitRule = {
  readonly limit: number;
  readonly windowSeconds: number;
};

/**
 * Every limited action on the platform, in one place.
 *
 * Named actions rather than route paths, because a limit belongs to the thing
 * being protected, not to the URL that happens to reach it. Two routes that both
 * mint a hand-over code must share one budget.
 *
 * The numbers are chosen so a legitimate user never meets them:
 *
 * - `HANDOVER_CODE_VERIFY` is the sharpest one on the list. Five wrong codes
 *   already kill the code itself (`MAX_OTP_ATTEMPTS`); this stops an agent
 *   grinding through *codes* — issue, fail five, ask for another — by capping the
 *   whole conversation at 20 submissions in ten minutes. A hand-over involves
 *   one, maybe three.
 * - `HANDOVER_CODE_ISSUE` allows ten in ten minutes: a student who mistypes,
 *   loses the screen, or hands the phone over twice is fine, while a script that
 *   rotates codes to widen the guessing surface is not.
 * - `PAYMENT_INITIATION` allows twelve per ten minutes. Abandoning a checkout
 *   and starting again is normal; two hundred initialisations are somebody
 *   probing Paystack on our key.
 * - `STUDENT_REGISTRATION` and `AUTH_CREDENTIALS` are per-IP as much as per-user
 *   (a credential-stuffing run has no account yet), which is why the caller
 *   passes both scopes.
 */
export const RATE_LIMITS = {
  /** Sign-in and password-reset attempts. Better Auth enforces its own too. */
  AUTH_CREDENTIALS: { limit: 10, windowSeconds: 300 },
  STUDENT_REGISTRATION: { limit: 5, windowSeconds: 3_600 },
  HANDOVER_CODE_ISSUE: { limit: 10, windowSeconds: 600 },
  HANDOVER_CODE_VERIFY: { limit: 20, windowSeconds: 600 },
  PAYMENT_INITIATION: { limit: 12, windowSeconds: 600 },
  PAYMENT_VERIFICATION: { limit: 60, windowSeconds: 600 },
  DOCUMENT_UPLOAD: { limit: 30, windowSeconds: 3_600 },
  DISPUTE_FILING: { limit: 10, windowSeconds: 3_600 },
  RATING_SUBMISSION: { limit: 30, windowSeconds: 3_600 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitAction = keyof typeof RATE_LIMITS;

/**
 * Whose allowance is being spent.
 *
 * Both are always checked when both are known, because one attacker with one
 * account and thirty students behind a shared campus NAT are different problems
 * and a single key cannot describe them both.
 */
export type RateLimitScope = "user" | "ip";

/** The window a moment falls in, as an integer index since the epoch. */
export function windowIndex(now: Date, windowSeconds: number): number {
  assertPositiveWindow(windowSeconds);
  return Math.floor(now.getTime() / (windowSeconds * 1_000));
}

/** The inclusive start of the window a moment falls in. */
export function windowStartedAt(now: Date, windowSeconds: number): Date {
  return new Date(windowIndex(now, windowSeconds) * windowSeconds * 1_000);
}

/**
 * The exclusive end of that window — the moment the allowance resets.
 *
 * Exclusive, like every other range on the platform (see the analytics ranges in
 * Phase 12): a request landing exactly on this instant belongs to the next
 * window, not to two.
 */
export function windowEndsAt(now: Date, windowSeconds: number): Date {
  return new Date((windowIndex(now, windowSeconds) + 1) * windowSeconds * 1_000);
}

/**
 * The counter's identity.
 *
 * The window index is part of the key, so a new window is a new row rather than a
 * row that has to be reset — there is no moment at which two callers race to
 * decide whose job it is to zero the counter. Old rows are simply dead and get
 * swept.
 *
 * The identifier is not hashed. These keys are user ids and IP addresses that the
 * platform already stores in `Session` and `AuditLog`; hashing here would only
 * make an operator reading the table unable to answer "who is being limited?".
 */
export function rateLimitKey(input: {
  action: RateLimitAction;
  scope: RateLimitScope;
  identifier: string;
  now: Date;
}): string {
  const rule = RATE_LIMITS[input.action];
  const index = windowIndex(input.now, rule.windowSeconds);
  return `${input.action}:${input.scope}:${input.identifier}:${index}`;
}

export type RateLimitDecision = {
  allowed: boolean;
  /** Attempts left in this window, never negative. */
  remaining: number;
  /** Whole seconds until the window resets. At least 1, so `Retry-After` is never 0. */
  retryAfterSeconds: number;
  limit: number;
};

/**
 * Judge a counter that has already been incremented.
 *
 * `hits` is the value *after* this attempt was counted, which is what an atomic
 * increment returns. Counting first and asking afterwards is the only ordering
 * that cannot be raced: two instances that both read 9 and both decide "one
 * left" have let 11 through.
 */
export function evaluate(input: {
  action: RateLimitAction;
  hits: number;
  now: Date;
}): RateLimitDecision {
  const rule = RATE_LIMITS[input.action];
  const allowed = input.hits <= rule.limit;

  return {
    allowed,
    remaining: Math.max(0, rule.limit - input.hits),
    retryAfterSeconds: secondsUntil(input.now, windowEndsAt(input.now, rule.windowSeconds)),
    limit: rule.limit,
  };
}

/** Whole seconds from `now` to `target`, rounded up, never below 1. */
export function secondsUntil(now: Date, target: Date): number {
  return Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 1_000));
}

/**
 * When a counter row stops mattering.
 *
 * Stored on the row so the sweep can delete by a single indexed comparison
 * instead of parsing window indexes out of keys.
 */
export function expiresAt(now: Date, action: RateLimitAction): Date {
  return windowEndsAt(now, RATE_LIMITS[action].windowSeconds);
}

function assertPositiveWindow(windowSeconds: number): void {
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    throw new Error("A rate-limit window must be a positive number of seconds");
  }
}
