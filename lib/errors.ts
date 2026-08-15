/**
 * Application error taxonomy.
 *
 * Every error carries an HTTP status and a stable machine-readable code so the
 * API layer can serialise failures consistently and clients can branch on the
 * code rather than on message text.
 */
export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "STATE_CONFLICT"
  | "RATE_LIMITED"
  | "PAYMENT_ERROR"
  /// The provider answered, but with a failure of its own (Phase 8).
  | "PAYMENT_PROVIDER_ERROR"
  /// This deployment has no payment credentials, so no money can move.
  | "PAYMENTS_NOT_CONFIGURED"
  | "INTERNAL_ERROR";


export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  /** True when the message is safe to show to end users. */
  readonly expose: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    status: number,
    options?: { details?: unknown; expose?: boolean; cause?: unknown },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = options?.details;
    this.expose = options?.expose ?? true;
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad request", details?: unknown) {
    super("BAD_REQUEST", message, 400, { details });
  }
}

export class ValidationError extends AppError {
  constructor(message = "The submitted data is invalid", details?: unknown) {
    super("VALIDATION_ERROR", message, 422, { details });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "You must be signed in") {
    super("UNAUTHENTICATED", message, 401);
  }
}

/** Used for role, ownership and campus-isolation failures alike. */
export class ForbiddenError extends AppError {
  constructor(message = "You are not allowed to perform this action") {
    super("FORBIDDEN", message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super("NOT_FOUND", message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Resource already exists", details?: unknown) {
    super("CONFLICT", message, 409, { details });
  }
}

/** A state-machine transition that is not legal from the current state. */
export class StateConflictError extends AppError {
  constructor(message = "This action is not allowed in the current state", details?: unknown) {
    super("STATE_CONFLICT", message, 409, { details });
  }
}

export class RateLimitedError extends AppError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds = 60, message = "Too many requests. Please try again shortly.") {
    super("RATE_LIMITED", message, 429);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class PaymentError extends AppError {
  constructor(message = "Payment could not be processed", details?: unknown) {
    super("PAYMENT_ERROR", message, 502, { details });
  }
}

export class InternalError extends AppError {
  constructor(message = "Something went wrong", cause?: unknown) {
    super("INTERNAL_ERROR", message, 500, { expose: false, cause });
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
