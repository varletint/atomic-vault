import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken, type JwtPayload } from "../utils/jwt.js";
import { AppError } from "../utils/AppError.js";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Authentication Middleware
 *
 * Intercepts incoming requests, checks for a valid access token in cookies,
 * and attaches the decoded user payload to `req.user`.
 * Throws a 401 Unauthorized securely if the token is missing or invalid.
 */
export const authMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const token = req.cookies?.accessToken as string | undefined;

  if (!token) {
    return next(
      new AppError(
        "Authentication required. Please log in.",
        401,
        "UNAUTHORIZED"
      )
    );
  }

  try {
    const decoded = verifyAccessToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    next(new AppError("Invalid or expired token.", 401, "UNAUTHORIZED"));
  }
};
