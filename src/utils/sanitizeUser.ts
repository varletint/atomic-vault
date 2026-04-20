import type { IUser } from "../models/index.js";

/**
 * Fields that should never be sent to storefront clients.
 * Admin-only endpoints bypass this and return the full document.
 */
const OMIT_KEYS: readonly string[] = [
  "password",
  "auth",
  "consents",
  "statusHistory",
  "deactivatedBy",
  "__v",
];

export type SafeUser = Omit<
  IUser,
  "password" | "auth" | "consents" | "statusHistory" | "deactivatedBy"
>;

/**
 * Strip internal / sensitive fields from a user document before
 * sending it to non-admin consumers (login, register, getMe, etc.).
 */
export function sanitizeUser(user: IUser | Record<string, unknown>): SafeUser {
  const obj: Record<string, unknown> =
    typeof (user as any).toObject === "function"
      ? (user as any).toObject()
      : { ...user };

  for (const key of OMIT_KEYS) {
    delete obj[key];
  }

  return obj as unknown as SafeUser;
}
