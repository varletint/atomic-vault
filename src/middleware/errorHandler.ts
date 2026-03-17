import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/AppError.js";

/**
 * Global Error Handler Middleware
 *
 * This MUST be registered LAST in your Express app (after all routes).
 * It catches every error that bubbles up from asyncHandler or next(err).
 *
 * - AppError (operational): Returns the structured error with its status code.
 * - Unknown Error (bug):    Logs the full error, returns a generic 500.
 *
 * Usage in app setup:
 *   app.use(errorHandler);
 */

// Mongoose validation error shape
interface MongooseValidationError extends Error {
  name: "ValidationError";
  errors: Record<string, { message: string }>;
}

// MongoDB duplicate key error shape
interface MongoDuplicateKeyError extends Error {
  code: number;
  keyPattern?: Record<string, unknown>;
}

function isMongooseValidationError(
  err: unknown
): err is MongooseValidationError {
  return err instanceof Error && err.name === "ValidationError";
}

function isMongoDuplicateKeyError(err: unknown): err is MongoDuplicateKeyError {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as MongoDuplicateKeyError).code === 11000
  );
}

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  // ── 1. Our own AppError (expected, operational) ──
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      code: err.code,
      error: err.message,
    });
    return;
  }

  // ── 2. Mongoose validation error ──
  if (isMongooseValidationError(err)) {
    const messages = Object.values(err.errors).map((e) => e.message);
    res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      error: "Validation failed.",
      details: messages,
    });
    return;
  }

  // ── 3. MongoDB duplicate key error (E11000) ──
  if (isMongoDuplicateKeyError(err)) {
    const field = err.keyPattern
      ? Object.keys(err.keyPattern).join(", ")
      : "field";
    res.status(409).json({
      success: false,
      code: "DUPLICATE",
      error: `Duplicate value for: ${field}.`,
    });
    return;
  }

  // ── 4. Unknown / unexpected error (bug) ──
  console.error("[UNEXPECTED ERROR]", err);
  res.status(500).json({
    success: false,
    code: "INTERNAL_ERROR",
    error: "Something went wrong. Please try again later.",
  });
};
