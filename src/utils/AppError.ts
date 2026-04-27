export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

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
