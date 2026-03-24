import jwt from "jsonwebtoken";
import type { UserRole } from "../models/User.js";

/**
 * JWT Utility
 *
 * Handles generating and verifying secure tokens for authentication.
 * Uses a dual-token strategy:
 *   - Access Token:  Short-lived (15m), used for API authorization.
 *   - Refresh Token: Long-lived (7d), used to silently re-issue access tokens.
 */

// In production, ALWAYS load these from environment variables.
const ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || "fallback_access_secret_do_not_use";
const REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || "fallback_refresh_secret_do_not_use";
const EMAIL_VERIFY_SECRET =
  process.env.EMAIL_VERIFY_SECRET || "fallback_email_verify_secret_do_not_use";

const ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || "15m";
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || "7d";
const EMAIL_VERIFY_EXPIRES_IN = process.env.EMAIL_VERIFY_EXPIRES_IN || "24h";

// ─────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────

export interface JwtPayload {
  userId: string;
  email: string;
  role: UserRole;
  /** Present on newly issued tokens; used to invalidate refresh tokens server-side */
  tokenVersion?: number;
}

// ─────────────────────────────────────────────────
// Token Generation
// ─────────────────────────────────────────────────

/**
 * Generates a short-lived access token.
 */
export const generateAccessToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, ACCESS_SECRET, {
    expiresIn: ACCESS_EXPIRES_IN,
  } as jwt.SignOptions);
};

/**
 * Generates a long-lived refresh token.
 */
export const generateRefreshToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, REFRESH_SECRET, {
    expiresIn: REFRESH_EXPIRES_IN,
  } as jwt.SignOptions);
};

// ─────────────────────────────────────────────────
// Token Verification
// ─────────────────────────────────────────────────

/**
 * Verifies and decodes a refresh token.
 * Throws if the token is expired or invalid.
 */
export const verifyRefreshToken = (token: string): JwtPayload => {
  return jwt.verify(token, REFRESH_SECRET) as JwtPayload;
};

/**
 * Verifies and decodes an access token.
 * Throws if the token is expired or invalid.
 */
export const verifyAccessToken = (token: string): JwtPayload => {
  return jwt.verify(token, ACCESS_SECRET) as JwtPayload;
};

// ─────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────

/**
 * Converts a JWT expiration string (e.g. "7d", "15m", "1h") to milliseconds.
 * Useful for setting cookie `maxAge`.
 */
export const parseExpirationToMs = (expiry: string): number => {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(`Invalid expiration format: "${expiry}"`);
  }

  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit]!;
};

/**
 * Returns the configured expiration strings for use in cookie settings.
 */
export const getExpirationConfig = () => ({
  accessExpiresIn: ACCESS_EXPIRES_IN,
  refreshExpiresIn: REFRESH_EXPIRES_IN,
});

// ─────────────────────────────────────────────────
// Email Verification Tokens
// ─────────────────────────────────────────────────

export interface EmailVerifyPayload {
  userId: string;
}

/**
 * Generates a short-lived token used in email verification links.
 */
export const generateEmailVerificationToken = (userId: string): string => {
  return jwt.sign({ userId } as EmailVerifyPayload, EMAIL_VERIFY_SECRET, {
    expiresIn: EMAIL_VERIFY_EXPIRES_IN,
  } as jwt.SignOptions);
};

/**
 * Verifies and decodes an email verification token.
 * Throws if the token is expired, tampered, or invalid.
 */
export const verifyEmailVerificationToken = (
  token: string
): EmailVerifyPayload => {
  return jwt.verify(token, EMAIL_VERIFY_SECRET) as EmailVerifyPayload;
};
