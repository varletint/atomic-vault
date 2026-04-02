import type { IUser } from "../models/index.js";
import { generateAccessToken, generateRefreshToken } from "../utils/jwt.js";

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

function getTokenVersion(user: IUser): number {
  return user.auth?.tokenVersion ?? 0;
}

export class AuthTokenService {
  static issueTokensForSession(user: IUser, sessionId: string): AuthTokens {
    const payload = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      tokenVersion: getTokenVersion(user),
      sessionId,
    };

    return {
      accessToken: generateAccessToken(payload),
      refreshToken: generateRefreshToken(payload),
    };
  }

  static currentTokenVersion(user: IUser): number {
    return getTokenVersion(user);
  }
}

