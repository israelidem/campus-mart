import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth/auth";
import { isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/security/rate-limit";

/**
 * Better Auth mounts all of its endpoints under /api/auth/*.
 *
 * Phase 13 wraps the POST handler to rate limit the credential endpoints. This
 * cannot go in `apiHandler`, because Better Auth owns the whole subtree and its
 * responses are its own; the wrapper therefore limits and then delegates, rather
 * than replacing anything.
 *
 * **Only the credential paths are limited, and that list is explicit.** A blanket
 * limit across `/api/auth/*` would also throttle `get-session`, which the app shell
 * calls on nearly every navigation — the limiter would then be a self-inflicted
 * outage rather than a defence. What needs limiting is guessing: sign-in, sign-up,
 * and the two mail-triggering endpoints, which cost real money per request.
 */
const LIMITED_PATHS = [
  "/sign-in/email",
  "/sign-up/email",
  "/forget-password",
  "/reset-password",
  "/send-verification-email",
] as const;

const handlers = toNextJsHandler(auth);

function isLimited(pathname: string): boolean {
  return LIMITED_PATHS.some((suffix) => pathname.endsWith(suffix));
}

export const GET = handlers.GET;

export async function POST(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (isLimited(pathname)) {
    try {
      // By IP alone. There is no session yet, and keying on the *submitted* email
      // would let an attacker spread a password-spray across many addresses while
      // each key stayed under its limit. The address is the thing being reused.
      await enforceRateLimit({ action: "AUTH_CREDENTIALS", headers: request.headers });
    } catch (error) {
      if (isAppError(error) && error.code === "RATE_LIMITED") {
        logger.warn("Auth request rate limited", { pathname });
        // Serialised here rather than by `apiHandler`, because this route does not
        // go through it. The shape matches `apiHandler`'s, so `lib/api/client.ts`
        // renders it like any other refusal.
        return new Response(
          JSON.stringify({
            error: { code: error.code, message: error.message },
          }),
          {
            status: error.status,
            headers: {
              "Content-Type": "application/json",
              // Better Auth's own responses are uncacheable; this one must be too.
              "Cache-Control": "no-store",
              "Retry-After": String(
                (error as { retryAfterSeconds?: number }).retryAfterSeconds ?? 60,
              ),
            },
          },
        );
      }
      throw error;
    }
  }

  return handlers.POST(request);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
