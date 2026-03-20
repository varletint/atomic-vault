import type { Request, Response, NextFunction } from "express";
import type { UserRole } from "../models/User.js";
import { AppError, ForbiddenError } from "../utils/AppError.js";

/**
 * Authorization guard: allows only users whose JWT `role` is in `allowed`.
 * Must run after `authMiddleware` so `req.user` is present.
 */
export const requireRole =
  (...allowed: UserRole[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(
        new AppError("Authentication required.", 401, "UNAUTHORIZED")
      );
    }
    const role = req.user.role;
    if (!role || !allowed.includes(role)) {
      return next(ForbiddenError("Insufficient permissions."));
    }
    next();
  };
