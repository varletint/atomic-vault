/**
 * AppError
 *
 * Custom error class for operational errors (expected things that go wrong).
 * Carries an HTTP status code and a machine-readable error code so the
 * global error handler can format the response without string-parsing.
 *
 * Usage:
 *   throw new AppError("User not found.", 404, "NOT_FOUND");
 *   throw new AppError("Illegal transition.", 409, "FSM_VIOLATION");
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true; // distinguishes known errors from unexpected crashes
    Object.setPrototypeOf(this, AppError.prototype); // fix instanceof in TS
  }
}

// ─────────────────────────────────────────────
// Factory helpers for common error types
// ─────────────────────────────────────────────

export const NotFoundError = (resource: string) =>
  new AppError(`${resource} not found.`, 404, "NOT_FOUND");

export const DuplicateError = (field: string) =>
  new AppError(`A record with that ${field} already exists.`, 409, "DUPLICATE");

export const FsmError = (from: string, to: string, allowed: string[]) =>
  new AppError(
    `Illegal transition: "${from}" → "${to}". Allowed from "${from}": [${allowed.join(
      ", "
    )}].`,
    409,
    "FSM_VIOLATION"
  );

export const ForbiddenError = (reason: string) =>
  new AppError(reason, 403, "FORBIDDEN");

export const ValidationError = (message: string) =>
  new AppError(message, 400, "VALIDATION_ERROR");
