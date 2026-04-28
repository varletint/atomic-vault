import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/AppError.js";
import { logger } from "../utils/logger.js";

interface MongooseValidationError extends Error {
  name: "ValidationError";
  errors: Record<string, { message: string }>;
}

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
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      code: err.code,
      error: err.message,
    });
    return;
  }

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

  logger.error("Unexpected error", {
    name: err.name,
    message: err.message,
    stack: err.stack,
  });
  res.status(500).json({
    success: false,
    code: "INTERNAL_ERROR",
    error: "Something went wrong. Please try again later.",
  });
};
