import { randomBytes } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/AppError.js";

const IS_PROD = process.env.NODE_ENV === "production";

const CSRF_COOKIE = "csrf-token";
const CSRF_HEADER = "x-csrf-token";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_EXEMPT_PATHS = new Set([
  "/api/orders/webhook/paystack",
  "/api/users/register",
  "/api/users/login",
  "/api/users/forgot-password",
  "/api/users/reset-password",
  "/api/users/resend-verification",
  "/api/users/refresh",
  "/api/users/logout",
  "/api/orders",
]);

export function generateCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

export function setCsrfCookie(res: Response, token: string): void {
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: IS_PROD,
    sameSite: IS_PROD ? ("none" as const) : ("lax" as const),
    path: "/",
    maxAge: 24 * 60 * 60 * 1000,
  });
}

export const csrfProtection = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  if (!UNSAFE_METHODS.has(req.method)) {
    return next();
  }

  if (CSRF_EXEMPT_PATHS.has(req.path)) {
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE] as string | undefined;
  const headerToken = req.headers[CSRF_HEADER] as string | undefined;

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return next(
      new AppError("CSRF token missing or invalid.", 403, "CSRF_INVALID")
    );
  }

  next();
};
