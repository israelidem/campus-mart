import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  AppError,
  InternalError,
  RateLimitedError,
  ValidationError,
  isAppError,
} from "@/lib/errors";
import { logger } from "@/lib/logger";

/** Standard success envelope. */
export type ApiSuccess<T> = { ok: true; data: T };
/** Standard failure envelope. */
export type ApiFailure = {
  ok: false;
  error: { code: string; message: string; details?: unknown };
};

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ ok: true, data }, init);
}

function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;

  if (error instanceof ZodError) {
    return new ValidationError("The submitted data is invalid", {
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  // Prisma unique-constraint violations surface as P2002.
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  ) {
    return new AppError("CONFLICT", "That record already exists", 409);
  }

  return new InternalError("Something went wrong", error);
}

/**
 * Wraps a route handler so every failure is logged once and serialised into
 * the standard envelope. Internal errors never leak their message to clients.
 */
export function apiHandler<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse> | NextResponse,
) {
  return async (...args: Args): Promise<NextResponse> => {
    try {
      return await handler(...args);
    } catch (error) {
      const appError = toAppError(error);

      const logContext = {
        code: appError.code,
        status: appError.status,
        error: appError,
      };
      if (appError.status >= 500) logger.error(appError.message, logContext);
      else logger.warn(appError.message, logContext);

      const body: ApiFailure = {
        ok: false,
        error: {
          code: appError.code,
          message: appError.expose ? appError.message : "Something went wrong",
          ...(appError.details ? { details: appError.details } : {}),
        },
      };

      const headers: Record<string, string> = {};
      if (appError instanceof RateLimitedError) {
        headers["Retry-After"] = String(appError.retryAfterSeconds);
      }

      return NextResponse.json(body, { status: appError.status, headers });
    }
  };
}
