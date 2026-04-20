import type { IUser } from "../models/index.js";

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
