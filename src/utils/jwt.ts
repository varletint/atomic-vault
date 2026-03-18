import jwt from "jsonwebtoken";
import { AppError } from "./AppError.js";

// ─────────────────────────────────────────────────
// Environment / Config
// ─────────────────────────────────────────────────

const ACCESS_TOKEN_SECRET =
  process.env.ACCESS_TOKEN_SECRET ?? "dev-access-secret";
const REFRESH_TOKEN_SECRET =
  process.env.REFRESH_TOKEN_SECRET ?? "dev-refresh-secret";

const ACCESS_TOKEN_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY ?? "15m";
const REFRESH_TOKEN_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY ?? "7d";

// ─────────────────────────────────────────────────
// parseExpirationToMs
// ─────────────────────────────────────────────────

/**
 * Converts a human-readable duration string into milliseconds.
 *
 * Supported units:
 *   s → seconds, m → minutes, h → hours, d → days, w → weeks
 *
 * @example
 *   parseExpirationToMs("15m")  // 900_000
 *   parseExpirationToMs("7d")   // 604_800_000
 *   parseExpirationToMs("1h")   // 3_600_000
 */
export function parseExpirationToMs(exp: string): number {
  const match = exp.match(/^(\d+)(s|m|h|d|w)$/);

  if (!match) {
    throw new AppError(
      `Invalid expiration format: "${exp}". Expected pattern: <number><s|m|h|d|w>.`,
      400,
      "INVALID_EXPIRATION"
    );
  }

  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;

  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };

  return value * multipliers[unit]!;
}

// ─────────────────────────────────────────────────
// generateAccessToken
// ─────────────────────────────────────────────────

/**
 * Signs a short-lived JWT intended for API authentication.
 *
 * @param payload - Data to embed in the token (e.g. `{ userId, email }`).
 * @returns Signed JWT string.
 */
export function generateAccessToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, ACCESS_TOKEN_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });
}

// ─────────────────────────────────────────────────
// generateRefreshToken
// ─────────────────────────────────────────────────

/**
 * Signs a long-lived JWT used to obtain new access tokens.
 *
 * @param payload - Data to embed in the token (e.g. `{ userId }`).
 * @returns Signed JWT string.
 */
export function generateRefreshToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, REFRESH_TOKEN_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });
}

// ─────────────────────────────────────────────────
// verifyRefreshToken
// ─────────────────────────────────────────────────

/**
 * Verifies and decodes a refresh token.
 *
 * @param token - The raw JWT string.
 * @returns The decoded payload.
 * @throws AppError (401) if the token is invalid or expired.
 */
export function verifyRefreshToken(token: string): jwt.JwtPayload {
  try {
    const decoded = jwt.verify(token, REFRESH_TOKEN_SECRET);

    if (typeof decoded === "string") {
      throw new AppError("Unexpected token format.", 401, "INVALID_TOKEN");
    }

    return decoded;
  } catch (error) {
    if (error instanceof AppError) throw error;

    // jsonwebtoken throws generic errors for expired / malformed tokens
    throw new AppError(
      "Refresh token is invalid or expired.",
      401,
      "INVALID_REFRESH_TOKEN"
    );
  }
}
