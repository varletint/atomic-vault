import rateLimit from "express-rate-limit";
import type { Request, Response } from "express";

/**
 * Shared handler factory for rate-limit responses.
 * Returns a structured JSON body with `retryAfter` in seconds.
 */
function rateLimitHandler(message: string) {
  return (_req: Request, res: Response) => {
    const retryAfter = Math.ceil(
      (res.getHeader("Retry-After") as number) ?? 60
    );
    res.status(429).json({
      success: false,
      error: message,
      retryAfter,
    });
  };
}

/**
 * Rate limiter for POST /resend-verification
 * 1 request per 60 seconds per IP.
 */
export const emailResendLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler(
    "Please wait before requesting another verification email."
  ),
});

/**
 * Rate limiter for POST /forgot-password
 * 1 request per 60 seconds per IP.
 */
export const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler(
    "Please wait before requesting another password reset code."
  ),
});

/**
 * Rate limiter for POST /reset-password
 * 5 requests per 15 minutes per IP.
 */
export const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler(
    "Too many password reset attempts. Please try again later."
  ),
});
