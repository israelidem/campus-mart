import { prisma } from "@/lib/db/prisma";
import { RateLimitedError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  evaluate,
  expiresAt,
  RATE_LIMITS,
  rateLimitKey,
  type RateLimitAction,
  type RateLimitDecision,
  type RateLimitScope,
} from "@/lib/security/rate-limit-policy";
import { clientIp } from "@/lib/security/request-identity";

/**
 * The rate limiter, backed by Postgres (Phase 13).
 *
 * The policy lives in `rate-limit-policy.ts` and is pure; this is the part that
 * touches the database, and it does exactly one interesting thing:
 *
 * ```sql
 * INSERT INTO "RateLimitCounter" (key, hits, expiresAt, ...)
 * VALUES ($1, 1, $2, ...)
 * ON CONFLICT (key) DO UPDATE SET hits = "RateLimitCounter".hits + 1
 * RETURNING hits
 * ```
 *
 * One statement, atomic, and it returns the post-increment value. That ordering
 * matters more than it looks: a limiter that *reads* then *decides* then *writes*
 * is wrong under concurrency, and concurrency is the only condition it exists for.
 * Two instances that both read 9 against a limit of 10 both conclude "allowed",
 * and 11 requests get through. Counting inside the write and judging the returned
 * number cannot do that.
 *
 * `$queryRaw` rather than Prisma's `upsert`, because `upsert` issues a select and
 * then a write, and `update: { hits: { increment: 1 } }` still needs the row to
 * exist first. The atomic form is not expressible through the query builder.
 */

/** Raw shape of the increment's `RETURNING`. */
type HitRow = { hits: number };

/**
 * Count one attempt and return the verdict, without throwing.
 *
 * Useful where a limit should be *observed* rather than enforced — a log line
 * about an admin hammering a dashboard is worth having, a 429 for the same is not.
 */
export async function countAttempt(input: {
  action: RateLimitAction;
  scope: RateLimitScope;
  identifier: string;
  now?: Date;
}): Promise<RateLimitDecision> {
  const now = input.now ?? new Date();
  const key = rateLimitKey({ ...input, now });
  const expiry = expiresAt(now, input.action);

  const rows = await prisma.$queryRaw<HitRow[]>`
    INSERT INTO "RateLimitCounter" ("key", "hits", "expiresAt", "createdAt", "updatedAt")
    VALUES (${key}, 1, ${expiry}, ${now}, ${now})
    ON CONFLICT ("key") DO UPDATE
      SET "hits" = "RateLimitCounter"."hits" + 1,
          "updatedAt" = ${now}
    RETURNING "hits"
  `;

  // A `RETURNING` on a guaranteed insert-or-update always yields one row. The
  // fallback treats an impossible empty result as "first attempt" rather than
  // throwing: a limiter that fails closed would take the platform down with it.
  const hits = rows[0]?.hits ?? 1;

  return evaluate({ action: input.action, hits, now });
}

/**
 * Count an attempt and refuse it if the allowance is spent.
 *
 * Throws `RateLimitedError`, which `apiHandler` already renders as 429 with a
 * `Retry-After` header — the limiter needed no new error type, and reusing the
 * existing one is why no route has to know how a limit is reported.
 *
 * Both scopes are checked when both are available, and **both are counted** even
 * if the first one already refuses. That is deliberate: an attacker rotating
 * accounts behind one IP must still spend the IP's budget, and stopping early
 * would let the second scope's counter sit idle while the first absorbs the blame.
 */
export async function enforceRateLimit(input: {
  action: RateLimitAction;
  userId?: string | null;
  headers?: Headers | null;
  /** Overrides the header-derived IP. Used by tests and by non-HTTP callers. */
  ip?: string | null;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const ip = input.ip ?? (input.headers ? clientIp(input.headers) : null);

  const scopes: Array<{ scope: RateLimitScope; identifier: string }> = [];
  if (input.userId) scopes.push({ scope: "user", identifier: input.userId });
  if (ip) scopes.push({ scope: "ip", identifier: ip });

  if (scopes.length === 0) {
    // Neither a session nor a usable address. Rather than invent a shared key —
    // which one attacker could exhaust on everybody else's behalf — the attempt
    // is allowed and recorded, so a deployment whose proxy strips these headers
    // is visible in the logs instead of silently unlimited.
    logger.warn("Rate limit skipped: no user or client IP available", {
      action: input.action,
    });
    return;
  }

  const decisions = await Promise.all(
    scopes.map(async (scope) => ({
      ...scope,
      decision: await countAttempt({ ...scope, action: input.action, now }),
    })),
  );

  const refused = decisions.find((entry) => !entry.decision.allowed);
  if (!refused) return;

  logger.warn("Rate limit exceeded", {
    action: input.action,
    scope: refused.scope,
    // The identifier is logged for the same reason `AuditLog.ipAddress` exists:
    // an operator investigating abuse needs to know who, and this is already
    // stored elsewhere for the same request.
    identifier: refused.identifier,
    limit: refused.decision.limit,
    windowSeconds: RATE_LIMITS[input.action].windowSeconds,
  });

  throw new RateLimitedError(
    refused.decision.retryAfterSeconds,
    "Too many attempts. Please wait before trying again.",
  );
}

/**
 * Delete counters whose window has closed.
 *
 * Called from the scheduled sweep. Without it the table grows forever: every
 * distinct key is a row, and the key includes a window index that changes by
 * design. Nothing depends on the rows being gone — a stale row is simply a
 * counter nobody will ever look up again — so this is housekeeping, and a failure
 * to run it is not a correctness problem.
 */
export async function purgeExpiredRateLimits(options?: { now?: Date }): Promise<number> {
  const now = options?.now ?? new Date();
  const result = await prisma.rateLimitCounter.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return result.count;
}
