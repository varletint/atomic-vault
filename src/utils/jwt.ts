import jwt from "jsonwebtoken";
import type { UserRole } from "../models/User.js";

const ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || "fallback_access_secret_do_not_use";
const REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || "fallback_refresh_secret_do_not_use";
const EMAIL_VERIFY_SECRET =
  process.env.EMAIL_VERIFY_SECRET || "fallback_email_verify_secret_do_not_use";

const ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || "15m";
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || "7d";
const EMAIL_VERIFY_EXPIRES_IN = process.env.EMAIL_VERIFY_EXPIRES_IN || "24h";

export interface JwtPayload {
  userId: string;
  email: string;
  role: UserRole;
  tokenVersion?: number;
  sessionId?: string;
}

export const generateAccessToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, ACCESS_SECRET, {
    expiresIn: ACCESS_EXPIRES_IN,
  } as jwt.SignOptions);
};

export const generateRefreshToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, REFRESH_SECRET, {
    expiresIn: REFRESH_EXPIRES_IN,
  } as jwt.SignOptions);
};

export const verifyRefreshToken = (token: string): JwtPayload => {
  return jwt.verify(token, REFRESH_SECRET) as JwtPayload;
};

export const verifyAccessToken = (token: string): JwtPayload => {
  return jwt.verify(token, ACCESS_SECRET) as JwtPayload;
};

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

export const getExpirationConfig = () => ({
  accessExpiresIn: ACCESS_EXPIRES_IN,
  refreshExpiresIn: REFRESH_EXPIRES_IN,
});

export interface EmailVerifyPayload {
  userId: string;
}

export const generateEmailVerificationToken = (userId: string): string => {
  return jwt.sign({ userId } as EmailVerifyPayload, EMAIL_VERIFY_SECRET, {
    expiresIn: EMAIL_VERIFY_EXPIRES_IN,
  } as jwt.SignOptions);
};

export const verifyEmailVerificationToken = (
  token: string
): EmailVerifyPayload => {
  return jwt.verify(token, EMAIL_VERIFY_SECRET) as EmailVerifyPayload;
};
