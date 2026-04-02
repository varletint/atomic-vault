import { createHash, randomUUID } from "node:crypto";
import { Session } from "../models/index.js";
import { ForbiddenError } from "../utils/AppError.js";
import { parseExpirationToMs, verifyRefreshToken } from "../utils/jwt.js";

type TokenPair = { accessToken: string; refreshToken: string };

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function refreshExpiryDate(): Date {
  return new Date(
    Date.now() + parseExpirationToMs(process.env.JWT_REFRESH_EXPIRES_IN || "7d")
  );
}

export class SessionService {
  static async createWithRefreshToken(params: {
    userId: string;
    refreshToken: string;
    sessionId?: string;
    ip?: string;
    userAgent?: string;
    lastUsedAt?: Date;
  }): Promise<{ sessionId: string }> {
    const sessionId = params.sessionId ?? randomUUID();
    const tokenFamilyId = randomUUID();

    const createData: {
      userId: string;
      sessionId: string;
      tokenFamilyId: string;
      refreshTokenHash: string;
      expiresAt: Date;
      lastUsedAt?: Date;
      ip?: string;
      userAgent?: string;
    } = {
      userId: params.userId,
      sessionId,
      tokenFamilyId,
      refreshTokenHash: hashRefreshToken(params.refreshToken),
      expiresAt: refreshExpiryDate(),
    };

    if (params.lastUsedAt) createData.lastUsedAt = params.lastUsedAt;
    if (params.ip) createData.ip = params.ip;
    if (params.userAgent) createData.userAgent = params.userAgent.slice(0, 512);

    await Session.create(createData);
    return { sessionId };
  }

  static async rotateRefreshToken(params: {
    userId: string;
    sessionId: string;
    refreshToken: string;
    issueTokens: (sessionId: string) => TokenPair;
  }): Promise<TokenPair> {
    const session = await Session.findOne({
      userId: params.userId,
      sessionId: params.sessionId,
      isRevoked: false,
      expiresAt: { $gt: new Date() },
    });
    if (!session) {
      throw ForbiddenError("Session not found or revoked. Please sign in again.");
    }

    const incomingHash = hashRefreshToken(params.refreshToken);
    if (session.refreshTokenHash !== incomingHash) {
      await Session.updateMany(
        { tokenFamilyId: session.tokenFamilyId, isRevoked: false },
        {
          $set: {
            isRevoked: true,
            revokedAt: new Date(),
            revokeReason: "TOKEN_REUSE_DETECTED",
          },
        }
      );
      throw ForbiddenError("Session compromised. Please sign in again.");
    }

    const nextTokens = params.issueTokens(params.sessionId);
    session.refreshTokenHash = hashRefreshToken(nextTokens.refreshToken);
    session.lastUsedAt = new Date();
    session.expiresAt = refreshExpiryDate();
    await session.save();

    return nextTokens;
  }

  static async revokeByRefreshToken(
    refreshToken: string,
    reason = "USER_LOGOUT"
  ): Promise<void> {
    let decoded: { userId: string; sessionId?: string } | null = null;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch {
      return;
    }
    if (!decoded?.sessionId) return;

    await Session.updateOne(
      {
        userId: decoded.userId,
        sessionId: decoded.sessionId,
        isRevoked: false,
      },
      {
        $set: {
          isRevoked: true,
          revokedAt: new Date(),
          revokeReason: reason,
        },
      }
    );
  }
}

