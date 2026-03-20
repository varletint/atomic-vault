import type { Request, Response, NextFunction } from "express";
import { AppError, ForbiddenError } from "../utils/AppError.js";

const normalizeEmail = (email: string): string => email.toLowerCase().trim();

/**
 * Authorization guard:
 * - Allows `ADMIN` to read any user's profile.
 * - Allows non-admin users to read only their own record.
 */
export const requireSelfOrAdmin = (opts: { type: "userId" | "email" }) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(
        new AppError("Authentication required.", 401, "UNAUTHORIZED")
      );
    }

    if (req.user.role === "ADMIN") {
      return next();
    }

    if (opts.type === "userId") {
      const paramUserId = req.params.userId;
      if (paramUserId && paramUserId === req.user.userId) {
        return next();
      }
      return next(ForbiddenError("Insufficient permissions."));
    }

    const paramEmail = req.params.email;
    if (
      typeof paramEmail === "string" &&
      normalizeEmail(paramEmail) === normalizeEmail(req.user.email)
    ) {
      return next();
    }

    return next(ForbiddenError("Insufficient permissions."));
  };
};

