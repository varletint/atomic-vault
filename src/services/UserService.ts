import { randomInt, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import {
  User,
  PasswordResetOtp,
  type IUser,
  type UserStatus,
} from "../models/index.js";
import {
  sendPasswordResetOtpEmail,
  sendVerificationEmail,
} from "./EmailService.js";
import {
  generateEmailVerificationToken,
  verifyRefreshToken,
} from "../utils/jwt.js";
import { SessionService } from "./SessionService.js";
import { AuthTokenService } from "./AuthTokenService.js";
import {
  AppError,
  NotFoundError,
  DuplicateError,
  FsmError,
  ForbiddenError,
  ValidationError,
} from "../utils/AppError.js";
import { logger } from "../utils/logger.js";
import { sanitizeUser, type SafeUser } from "../utils/sanitizeUser.js";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  user: SafeUser;
  tokens: AuthTokens;
}

const ALLOWED_TRANSITIONS: Record<UserStatus, UserStatus[]> = {
  UNVERIFIED: ["ACTIVE", "DEACTIVATED"],
  ACTIVE: ["SUSPENDED", "DEACTIVATED"],
  SUSPENDED: ["ACTIVE", "DEACTIVATED"],
  DEACTIVATED: [], // terminal state
};

function assertValidTransition(current: UserStatus, next: UserStatus): void {
  const allowed = ALLOWED_TRANSITIONS[current];

  if (!allowed.includes(next)) {
    throw FsmError(current, next, allowed);
  }
}

const MAX_FAILED_LOGIN_ATTEMPTS = Math.max(
  1,
  parseInt(process.env.AUTH_MAX_FAILED_LOGINS ?? "5", 10) || 5
);
const LOCKOUT_MINUTES = Math.max(
  1,
  parseInt(process.env.AUTH_LOCKOUT_MINUTES ?? "15", 10) || 15
);

const LOCKOUT_MS = LOCKOUT_MINUTES * 60 * 1000;

const CLIENT_URL = (process.env.CLIENT_URL ?? "http://localhost:5173").replace(
  /\/$/,
  ""
);
const PASSWORD_RESET_OTP_TTL_MINUTES = Math.max(
  5,
  parseInt(process.env.PASSWORD_RESET_OTP_TTL_MINUTES ?? "15", 10) || 15
);
const PASSWORD_RESET_MAX_OTP_ATTEMPTS = Math.max(
  3,
  parseInt(process.env.PASSWORD_RESET_MAX_OTP_ATTEMPTS ?? "5", 10) || 5
);

const PASSWORD_RESET_EMAIL_MAX_PER_HOUR = Math.max(
  1,
  parseInt(process.env.PASSWORD_RESET_EMAIL_MAX_PER_HOUR ?? "3", 10) || 3
);

function bumpTokenVersion(user: IUser): void {
  if (!user.auth) {
    user.auth = {
      failedLoginAttempts: 0,
      tokenVersion: 0,
      mfa: {
        enabled: false,
        method: "NONE",
        backupCodesHash: [],
      },
    };
  }
  user.auth.tokenVersion = (user.auth.tokenVersion ?? 0) + 1;
  (user as mongoose.Document).markModified("auth");
}

export class UserService {
  static async register(data: {
    name: string;
    email: string;
    password: string;
    address: IUser["address"];
  }): Promise<AuthResponse> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const existing = await User.findOne({ email: data.email }).session(
        session
      );
      if (existing) {
        throw DuplicateError("email");
      }

      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash(data.password, salt);

      const [user] = await User.create(
        [
          {
            name: data.name,
            email: data.email,
            password: hashedPassword,
            status: "UNVERIFIED" as const,
            isEmailVerified: false,
            address: data.address,
            statusHistory: [
              {
                status: "UNVERIFIED" as const,
                timestamp: new Date(),
                reason: "Account created",
              },
            ],
          },
        ],
        { session }
      );

      await session.commitTransaction();

      try {
        const verifyToken = generateEmailVerificationToken(
          user!._id.toString()
        );
        const verifyUrl = `${CLIENT_URL}/verify-email?token=${verifyToken}`;
        logger.debug("Sending verification email", {
          userId: user!._id.toString(),
        });
        await sendVerificationEmail(data.email, verifyUrl);
        logger.info("Verification email sent", {
          userId: user!._id.toString(),
        });
      } catch (emailErr) {
        logger.error("Failed to send verification email", {
          userId: user!._id.toString(),
          error:
            emailErr instanceof Error ? emailErr.message : String(emailErr),
        });
      }

      const safeUser = sanitizeUser(user!);

      const sessionId = randomUUID();
      const tokens = AuthTokenService.issueTokensForSession(
        user!.toObject() as IUser,
        sessionId
      );
      await SessionService.createWithRefreshToken({
        userId: user!._id.toString(),
        refreshToken: tokens.refreshToken,
        sessionId,
      });

      return { user: safeUser, tokens };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  static async login(
    email: string,
    password: string,
    meta?: { ip?: string; userAgent?: string }
  ): Promise<AuthResponse> {
    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail }).select(
      "+password"
    );

    if (!user) {
      throw NotFoundError("User");
    }

    const now = new Date();
    const lockedUntil = user.auth?.lockedUntil;
    if (lockedUntil && lockedUntil > now) {
      throw ForbiddenError(
        "Account temporarily locked due to failed login attempts. Try again later."
      );
    }

    const isValid = await bcrypt.compare(password, user.password);

    if (!isValid) {
      const attempts = (user.auth?.failedLoginAttempts ?? 0) + 1;
      if (!user.auth) {
        user.auth = {
          failedLoginAttempts: attempts,
          tokenVersion: 0,
          mfa: {
            enabled: false,
            method: "NONE",
            backupCodesHash: [],
          },
        };
      } else {
        user.auth.failedLoginAttempts = attempts;
      }
      if (attempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
        user.auth.lockedUntil = new Date(now.getTime() + LOCKOUT_MS);
      }
      user.markModified("auth");
      await user.save();
      throw ValidationError("Invalid email or password.");
    }

    if (user.status === "UNVERIFIED") {
      throw new AppError(
        "Please verify your email before logging in.",
        403,
        "EMAIL_NOT_VERIFIED"
      );
    }

    if (user.status !== "ACTIVE" && user.status !== "SUSPENDED") {
      throw ForbiddenError(`Login denied. Account status is "${user.status}".`);
    }

    if (!user.auth) {
      user.auth = {
        failedLoginAttempts: 0,
        tokenVersion: 0,
        mfa: {
          enabled: false,
          method: "NONE",
          backupCodesHash: [],
        },
      };
    }
    user.auth.failedLoginAttempts = 0;
    if (user.auth.lockedUntil) {
      delete user.auth.lockedUntil;
    }
    user.auth.lastLoginAt = now;
    if (meta?.ip) {
      user.auth.lastLoginIp = meta.ip;
    }
    if (meta?.userAgent) {
      user.auth.lastLoginDevice = meta.userAgent.slice(0, 512);
    }
    user.markModified("auth");
    await user.save();

    const safeUser = sanitizeUser(user);

    const sessionId = randomUUID();
    const tokens = AuthTokenService.issueTokensForSession(
      user.toObject() as IUser,
      sessionId
    );
    const createSessionInput: {
      userId: string;
      refreshToken: string;
      sessionId: string;
      lastUsedAt: Date;
      ip?: string;
      userAgent?: string;
    } = {
      userId: user._id.toString(),
      refreshToken: tokens.refreshToken,
      sessionId,
      lastUsedAt: now,
    };
    if (meta?.ip) createSessionInput.ip = meta.ip;
    if (meta?.userAgent) createSessionInput.userAgent = meta.userAgent;
    await SessionService.createWithRefreshToken(createSessionInput);

    return { user: safeUser, tokens };
  }

  static async requestPasswordResetOtp(email: string): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail }).select(
      "_id status"
    );

    if (!user || user.status === "DEACTIVATED") {
      return;
    }

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await PasswordResetOtp.countDocuments({
      userId: user._id,
      createdAt: { $gte: hourAgo },
    });
    if (recentCount >= PASSWORD_RESET_EMAIL_MAX_PER_HOUR) {
      return;
    }

    await PasswordResetOtp.deleteMany({
      userId: user._id,
      usedAt: null,
    });

    const otp = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const salt = await bcrypt.genSalt(10);
    const codeHash = await bcrypt.hash(otp, salt);
    const expiresAt = new Date(
      Date.now() + PASSWORD_RESET_OTP_TTL_MINUTES * 60 * 1000
    );

    await PasswordResetOtp.create({
      userId: user._id,
      email: normalizedEmail,
      codeHash,
      expiresAt,
    });

    await sendPasswordResetOtpEmail(normalizedEmail, otp);
  }

  static async resetPasswordWithOtp(
    email: string,
    otp: string,
    newPassword: string
  ): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim();
    const normalizedOtp = otp.trim();

    if (!/^\d{6}$/.test(normalizedOtp)) {
      throw ValidationError("Invalid reset code.");
    }

    const user = await User.findOne({ email: normalizedEmail }).select(
      "+password"
    );

    if (!user || user.status === "DEACTIVATED") {
      throw ValidationError("Invalid or expired reset code.");
    }

    const challenge = await PasswordResetOtp.findOne({
      userId: user._id,
      usedAt: null,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!challenge) {
      throw ValidationError("Invalid or expired reset code.");
    }

    if (challenge.attempts >= PASSWORD_RESET_MAX_OTP_ATTEMPTS) {
      throw ValidationError("Too many attempts. Request a new code.");
    }

    const match = await bcrypt.compare(normalizedOtp, challenge.codeHash);
    if (!match) {
      challenge.attempts += 1;
      await challenge.save();
      throw ValidationError("Invalid or expired reset code.");
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const lockedChallenge = await PasswordResetOtp.findById(
        challenge._id
      ).session(session);

      if (
        !lockedChallenge ||
        lockedChallenge.usedAt != null ||
        lockedChallenge.expiresAt <= new Date()
      ) {
        throw ValidationError("Invalid or expired reset code.");
      }

      const u = await User.findById(user._id)
        .session(session)
        .select("+password");

      if (!u || u.status === "DEACTIVATED") {
        throw ValidationError("Invalid or expired reset code.");
      }

      const pwSalt = await bcrypt.genSalt(12);
      u.password = await bcrypt.hash(newPassword, pwSalt);

      if (!u.auth) {
        u.auth = {
          failedLoginAttempts: 0,
          tokenVersion: 0,
          mfa: {
            enabled: false,
            method: "NONE",
            backupCodesHash: [],
          },
        };
      }
      u.auth.failedLoginAttempts = 0;
      if (u.auth.lockedUntil) {
        delete u.auth.lockedUntil;
      }
      u.auth.passwordChangedAt = new Date();
      bumpTokenVersion(u);

      await u.save({ session });

      lockedChallenge.usedAt = new Date();
      await lockedChallenge.save({ session });

      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  static async refreshTokens(token: string): Promise<AuthTokens> {
    const decoded = verifyRefreshToken(token);
    const versionInToken = decoded.tokenVersion ?? 0;
    const sessionId = decoded.sessionId;
    if (!sessionId) {
      throw ForbiddenError("Session missing in token. Please sign in again.");
    }

    const user = await User.findById(decoded.userId)
      .select("-password")
      .lean<IUser>();

    if (!user) {
      throw NotFoundError("User");
    }

    if (user.status === "DEACTIVATED") {
      throw ForbiddenError("Account is deactivated. Token refresh denied.");
    }

    const currentVersion = AuthTokenService.currentTokenVersion(user);
    if (versionInToken !== currentVersion) {
      throw ForbiddenError("Session expired. Please sign in again.");
    }

    return SessionService.rotateRefreshToken({
      userId: user._id.toString(),
      sessionId,
      refreshToken: token,
      issueTokens: (sid) => AuthTokenService.issueTokensForSession(user, sid),
    });
  }

  static async logoutByRefreshToken(token: string): Promise<void> {
    await SessionService.revokeByRefreshToken(token, "USER_LOGOUT");
  }

  private static async transitionStatus(
    userId: string,
    nextStatus: UserStatus,
    reason?: string
  ): Promise<IUser> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.findById(userId).session(session);
      if (!user) {
        throw NotFoundError("User");
      }

      assertValidTransition(user.status, nextStatus);

      user.status = nextStatus;
      const historyEntry: any = {
        status: nextStatus,
        timestamp: new Date(),
      };
      if (reason !== undefined) {
        historyEntry.reason = reason;
      }
      user.statusHistory.push(historyEntry);

      if (nextStatus === "SUSPENDED" || nextStatus === "DEACTIVATED") {
        bumpTokenVersion(user);
      }

      await user.save({ session });
      await session.commitTransaction();

      return sanitizeUser(user) as IUser;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  static async verifyEmail(userId: string): Promise<AuthResponse> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.findById(userId).session(session);
      if (!user) {
        throw NotFoundError("User");
      }

      assertValidTransition(user.status, "ACTIVE");

      if (user.isEmailVerified) {
        throw ValidationError("Email is already verified.");
      }

      user.status = "ACTIVE";
      user.isEmailVerified = true;
      user.statusHistory.push({
        status: "ACTIVE",
        timestamp: new Date(),
        reason: "Email verified",
      });

      await user.save({ session });
      await session.commitTransaction();

      const sessionId = randomUUID();
      const tokens = AuthTokenService.issueTokensForSession(
        user.toObject() as IUser,
        sessionId
      );
      await SessionService.createWithRefreshToken({
        userId: user._id.toString(),
        refreshToken: tokens.refreshToken,
        sessionId,
      });

      return { user: sanitizeUser(user), tokens };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  static async resendVerificationEmail(email: string): Promise<void> {
    logger.debug("Resending verification email", {
      userId: "(lookup by email)",
    });
    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail }).select(
      "_id email status isEmailVerified auth"
    );

    if (!user) return;

    if (user.isEmailVerified || user.status !== "UNVERIFIED") {
      throw ValidationError("Email is already verified.");
    }

    const lastSent = user.auth?.lastVerificationEmailSentAt;
    if (lastSent) {
      const elapsed = Date.now() - new Date(lastSent).getTime();
      if (elapsed < 60_000) {
        return;
      }
    }

    if (!user.auth) {
      user.auth = {
        failedLoginAttempts: 0,
        tokenVersion: 0,
        mfa: {
          enabled: false,
          method: "NONE",
          backupCodesHash: [],
        },
      };
    }
    user.auth.lastVerificationEmailSentAt = new Date();
    (user as mongoose.Document).markModified("auth");
    await user.save();

    const verifyToken = generateEmailVerificationToken(user._id.toString());
    const verifyUrl = `${CLIENT_URL}/verify-email?token=${verifyToken}`;

    await sendVerificationEmail(user.email, verifyUrl);
  }

  static async suspendUser(userId: string, reason: string): Promise<IUser> {
    return UserService.transitionStatus(userId, "SUSPENDED", reason);
  }

  static async reactivateUser(userId: string, reason: string): Promise<IUser> {
    return UserService.transitionStatus(userId, "ACTIVE", reason);
  }

  static async deactivateUser(userId: string, reason: string): Promise<IUser> {
    return UserService.transitionStatus(userId, "DEACTIVATED", reason);
  }

  static async getUserById(userId: string): Promise<IUser | null> {
    return User.findById(userId).select("-password").lean<IUser>();
  }

  static async getUserByEmail(email: string): Promise<IUser | null> {
    return User.findOne({ email: email.toLowerCase().trim() })
      .select("-password")
      .lean<IUser>();
  }

  static async updateProfile(
    userId: string,
    data: { name?: string; address?: IUser["address"] }
  ): Promise<IUser> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.findById(userId).session(session);
      if (!user) {
        throw NotFoundError("User");
      }

      if (user.status !== "ACTIVE") {
        throw ForbiddenError(
          `Profile update denied. User status is "${user.status}". Only ACTIVE users can update their profile.`
        );
      }

      if (data.name !== undefined) {
        user.name = data.name;
      }

      if (data.address !== undefined) {
        user.address = data.address;
      }

      await user.save({ session });
      await session.commitTransaction();

      return sanitizeUser(user) as IUser;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  static async getUsersAdmin(filters: {
    page: number;
    limit: number;
    search?: string;
    role?: string;
    status?: string;
  }): Promise<{ users: IUser[]; total: number; totalPages: number }> {
    const { page, limit, search, role, status } = filters;
    const query: Record<string, any> = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }
    if (role) {
      query.role = role;
    }
    if (status) {
      query.status = status;
    }

    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      User.find(query)
        .select("-password")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean<IUser[]>(),
      User.countDocuments(query),
    ]);

    return {
      users,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }
}
