import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { expireGoodsPayments, expirePickups } from "@/lib/delivery/delivery-service";
import { env } from "@/lib/env";
import { ForbiddenError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * The scheduled sweep (PRD §41, §47).
 *
 * Two deadlines on the platform pass without anybody pressing a button: an
 * accepted delivery that is never picked up, and a verified hand-over that is
 * never paid for. Both are already implemented as named operations that take a
 * clock; this route only decides *when* they run, and says how many rows moved.
 *
 * Authentication is a shared secret in a header, not a session:
 *
 *  - A scheduler has no cookie, so `requireActor()` would reject every call.
 *  - The sweeps cancel deliveries and send goods back. Left open, anyone could
 *    expire another campus's work by hitting a URL, so the secret is mandatory
 *    here even though it is optional in the environment schema — a deployment
 *    without one gets a 403 rather than an unguarded endpoint.
 *
 * Both timing-safe comparison and the constant-time property are deliberately
 * not attempted: this is a fixed high-entropy string, and a length check plus
 * equality is what the platform's other secret comparisons do.
 *
 * The response reports each sweep separately. "0 expired" is a useful answer —
 * it means the sweep ran and nothing was overdue, which is what a healthy
 * platform looks like.
 */
export const POST = apiHandler(async (request: Request): Promise<NextResponse> => {
  const expected = env().CRON_SECRET;
  if (!expected) {
    throw new ForbiddenError("Scheduled sweeps are not configured on this deployment");
  }

  // `Authorization: Bearer <secret>` is what Vercel Cron sends, and a plain
  // header is accepted too so any scheduler can call it.
  const header =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.headers.get("x-cron-secret");

  if (header !== expected) {
    throw new ForbiddenError("Invalid cron secret");
  }

  // One clock for both sweeps: a delivery must not be judged late by one and
  // on time by the other because a second passed between the two queries.
  const now = new Date();

  const [expiredPickups, expiredPayments] = await Promise.all([
    expirePickups({ now }),
    expireGoodsPayments({ now }),
  ]);

  if (expiredPickups > 0 || expiredPayments > 0) {
    // Worth a line in the log: every one of these is a student who did not get
    // their order, and a pattern here is an operational problem, not a bug.
    logger.info("Scheduled sweep expired overdue work", { expiredPickups, expiredPayments });
  }

  return jsonOk({ sweptAt: now.toISOString(), expiredPickups, expiredPayments });
});
