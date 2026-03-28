import { randomInt } from "node:crypto";
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
  generateAccessToken,
  generateRefreshToken,
  generateEmailVerificationToken,
  verifyRefreshToken,
} from "../utils/jwt.js";
import {
  NotFoundError,
  DuplicateError,
  FsmError,
  ForbiddenError,
  ValidationError,
} from "../utils/AppError.js";

/**
 * UserService
 *
 * All user lifecycle operations live here.
 * Uses a strict Finite State Machine (FSM) to govern account status
 * transitions, and MongoDB sessions for ACID compliance.
 *
 * FSM Transition Map:
 *   UNVERIFIED  → ACTIVE, DEACTIVATED
 *   ACTIVE      → SUSPENDED, DEACTIVATED
 *   SUSPENDED   → ACTIVE, DEACTIVATED
 *   DEACTIVATED → (terminal – no transitions allowed)
 */

// ─────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  user: IUser;
  tokens: AuthTokens;
}

// ─────────────────────────────────────────────────
// FSM Definition
// ─────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<UserStatus, UserStatus[]> = {
  UNVERIFIED: ["ACTIVE", "DEACTIVATED"],
  ACTIVE: ["SUSPENDED", "DEACTIVATED"],
  SUSPENDED: ["ACTIVE", "DEACTIVATED"],
  DEACTIVATED: [], // terminal state
};

/**
 * Validates whether a status transition is legal.
 * Throws a structured AppError (409 FSM_VIOLATION) if not.
 */
function assertValidTransition(current: UserStatus, next: UserStatus): void {
  const allowed = ALLOWED_TRANSITIONS[current];

  if (!allowed.includes(next)) {
    throw FsmError(current, next, allowed);
  }
}

// ─────────────────────────────────────────────────
// Token Helper
// ─────────────────────────────────────────────────

/**
 * Generates an access + refresh token pair for a given user.
 */
function getTokenVersion(user: IUser): number {
  return user.auth?.tokenVersion ?? 0;
}

function issueTokens(user: IUser): AuthTokens {
  const payload = {
    userId: user._id.toString(),
    email: user.email,
    role: user.role,
    tokenVersion: getTokenVersion(user),
  };

  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload),
  };
}

/** Max failed password attempts before lockout (env: AUTH_MAX_FAILED_LOGINS, default 5) */
const MAX_FAILED_LOGIN_ATTEMPTS = Math.max(
  1,
  parseInt(process.env.AUTH_MAX_FAILED_LOGINS ?? "5", 10) || 5
);

/** Lockout duration in minutes after threshold (env: AUTH_LOCKOUT_MINUTES, default 15) */
const LOCKOUT_MINUTES = Math.max(
  1,
  parseInt(process.env.AUTH_LOCKOUT_MINUTES ?? "15", 10) || 15
);

const LOCKOUT_MS = LOCKOUT_MINUTES * 60 * 1000;

/** Base URL of the frontend app for verification links */
const CLIENT_URL = (process.env.CLIENT_URL ?? "http://localhost:5173").replace(
  /\/$/,
  ""
);

/** OTP validity window (minutes). Env: PASSWORD_RESET_OTP_TTL_MINUTES, default 15, min 5 */
const PASSWORD_RESET_OTP_TTL_MINUTES = Math.max(
  5,
  parseInt(process.env.PASSWORD_RESET_OTP_TTL_MINUTES ?? "15", 10) || 15
);

/** Max wrong OTP attempts per challenge before requiring a new code */
const PASSWORD_RESET_MAX_OTP_ATTEMPTS = Math.max(
  3,
  parseInt(process.env.PASSWORD_RESET_MAX_OTP_ATTEMPTS ?? "5", 10) || 5
);

/** Max reset emails per user per rolling hour (abuse throttle) */
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

// ─────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────

export class UserService {
  // ─────────────────────────────────────────────────
  // Registration
  // ─────────────────────────────────────────────────

  /**
   * Creates a new user account and issues a token pair.
   * Initial status is always UNVERIFIED (enforced by FSM).
   *
   * @param data - User registration payload (name, email, raw password, address).
   * @returns The created user document + JWT tokens.
   */
  static async register(data: {
    name: string;
    email: string;
    password: string;
    address: IUser["address"];
  }): Promise<AuthResponse> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Check for duplicate email within the transaction
      const existing = await User.findOne({ email: data.email }).session(
        session
      );
      if (existing) {
        throw DuplicateError("email");
      }

      // Hash password with bcrypt before saving (cost factor 12)
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

      // Send verification email (don't block registration on failure)
      try {
        const verifyToken = generateEmailVerificationToken(
          user!._id.toString()
        );
        const verifyUrl = `${CLIENT_URL}/verify-email?token=${verifyToken}`;
        console.log(
          `[UserService] Sending verification email to ${data.email}…`
        );
        await sendVerificationEmail(data.email, verifyUrl);
        console.log(`[UserService] Verification email sent to ${data.email}`);
      } catch (emailErr) {
        console.error(
          `[UserService] FAILED to send verification email to ${data.email}:`,
          emailErr
        );
      }

      // Strip password before returning
      const { password: removedPassword, ...safeUser } =
        user!.toObject() as IUser & { password?: string };
      void removedPassword;

      const tokens = issueTokens(safeUser as IUser);

      return { user: safeUser as IUser, tokens };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  // ─────────────────────────────────────────────────
  // Authentication
  // ─────────────────────────────────────────────────

  /**
   * Authenticates a user by email and password.
   * Only ACTIVE or SUSPENDED users may log in (UNVERIFIED and DEACTIVATED cannot).
   *
   * @param email - User's email address.
   * @param password - Raw password to compare.
   * @returns The user document + JWT tokens.
   */
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

    // Only ACTIVE or SUSPENDED users can log in
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
    user.auth.lockedUntil = undefined;
    user.auth.lastLoginAt = now;
    if (meta?.ip) {
      user.auth.lastLoginIp = meta.ip;
    }
    if (meta?.userAgent) {
      user.auth.lastLoginDevice = meta.userAgent.slice(0, 512);
    }
    user.markModified("auth");
    await user.save();

    const safeUser = user.toObject();
    delete (safeUser as { password?: string }).password;

    const tokens = issueTokens(safeUser as IUser);

    return { user: safeUser as IUser, tokens };
  }

  /**
   * Creates a short-lived OTP challenge and emails the code.
   * Always completes without error (no email enumeration); skips send for
   * unknown emails, DEACTIVATED accounts, or when hourly rate limit is hit.
   */
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

  /**
   * Verifies the latest unused OTP and sets a new password.
   * Bumps `auth.tokenVersion` so existing JWTs are invalidated.
   */
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

  /**
   * Issues a fresh access token using a valid refresh token.
   *
   * @param token - The refresh token string.
   * @returns A new token pair.
   */
  static async refreshTokens(token: string): Promise<AuthTokens> {
    const decoded = verifyRefreshToken(token);
    const versionInToken = decoded.tokenVersion ?? 0;

    const user = await User.findById(decoded.userId)
      .select("-password")
      .lean<IUser>();

    if (!user) {
      throw NotFoundError("User");
    }

    if (user.status === "DEACTIVATED") {
      throw ForbiddenError("Account is deactivated. Token refresh denied.");
    }

    const currentVersion = getTokenVersion(user);
    if (versionInToken !== currentVersion) {
      throw ForbiddenError("Session expired. Please sign in again.");
    }

    return issueTokens(user);
  }

  // ─────────────────────────────────────────────────
  // FSM Transitions
  // ─────────────────────────────────────────────────

  /**
   * Core FSM transition method.
   * Validates the move, updates status atomically, and logs to statusHistory.
   * All public transition methods delegate to this.
   */
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

      // FSM guard
      assertValidTransition(user.status, nextStatus);

      // Atomic update: set new status + push audit entry
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

      return user;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Verify a user's email → transitions UNVERIFIED → ACTIVE.
   * Sets `isEmailVerified` to true and issues a token pair.
   */
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

      const tokens = issueTokens(user.toObject() as IUser);

      return { user: user.toObject() as IUser, tokens };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Re-sends the verification email for an unverified user.
   * Validates the user is still UNVERIFIED before sending.
   */
  static async resendVerificationEmail(userId: string): Promise<void> {
    const user = await User.findById(userId).select(
      "email status isEmailVerified"
    );

    if (!user) {
      throw NotFoundError("User");
    }

    if (user.isEmailVerified || user.status !== "UNVERIFIED") {
      throw ValidationError("Email is already verified.");
    }

    const verifyToken = generateEmailVerificationToken(userId);
    const verifyUrl = `${CLIENT_URL}/verify-email?token=${verifyToken}`;

    await sendVerificationEmail(user.email, verifyUrl);
  }

  /**
   * Suspend a user → transitions ACTIVE → SUSPENDED.
   * Suspended users can log in but cannot place orders or transact.
   */
  static async suspendUser(userId: string, reason: string): Promise<IUser> {
    return UserService.transitionStatus(userId, "SUSPENDED", reason);
  }

  /**
   * Reactivate a suspended user → transitions SUSPENDED → ACTIVE.
   */
  static async reactivateUser(userId: string, reason: string): Promise<IUser> {
    return UserService.transitionStatus(userId, "ACTIVE", reason);
  }

  /**
   * Deactivate a user → terminal state.
   * Can be reached from UNVERIFIED, ACTIVE, or SUSPENDED.
   * Data is preserved for ACID audit trails, but the user can no longer log in.
   */
  static async deactivateUser(userId: string, reason: string): Promise<IUser> {
    return UserService.transitionStatus(userId, "DEACTIVATED", reason);
  }

  // ─────────────────────────────────────────────────
  // Read Operations
  // ─────────────────────────────────────────────────

  /**
   * Get a user by their ID. Excludes the password field.
   */
  static async getUserById(userId: string): Promise<IUser | null> {
    return User.findById(userId).select("-password").lean<IUser>();
  }

  /**
   * Get a user by their email. Excludes the password field.
   * Useful for login flows (caller would need to separately
   * compare passwords using the auth layer).
   */
  static async getUserByEmail(email: string): Promise<IUser | null> {
    return User.findOne({ email: email.toLowerCase().trim() })
      .select("-password")
      .lean<IUser>();
  }

  // ─────────────────────────────────────────────────
  // Profile Update
  // ─────────────────────────────────────────────────

  /**
   * Update a user's profile (name and/or address).
   * Only ACTIVE users may update their profile (FSM enforcement).
   */
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

      // Only ACTIVE users can modify their profile
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

      return user;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }
}
