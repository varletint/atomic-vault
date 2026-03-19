import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { UserService } from "../services/UserService.js";
import { ValidationError } from "../utils/AppError.js";
import { parseExpirationToMs } from "../utils/jwt.js";

/**
 * Cookie configuration for access and refresh tokens.
 */
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
};

function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string }
): void {
  res.cookie("accessToken", tokens.accessToken, {
    ...COOKIE_OPTIONS,
    maxAge: parseExpirationToMs(process.env.JWT_ACCESS_EXPIRES_IN || "15m"),
  });

  res.cookie("refreshToken", tokens.refreshToken, {
    ...COOKIE_OPTIONS,
    path: "/api/users/refresh", // only sent to the refresh endpoint
    maxAge: parseExpirationToMs(process.env.JWT_REFRESH_EXPIRES_IN || "7d"),
  });
}

/**
 * UserController
 *
 * Thin HTTP layer. Each method:
 *   1. Extracts data from the request.
 *   2. Calls the appropriate UserService method.
 *   3. Returns the result as JSON.
 *
 * All error handling is delegated to asyncHandler + the global errorHandler.
 * No try/catch blocks needed here.
 */
export class UserController {
  //   Registration

  /**
   * POST /api/users/register
   * Body: { name, email, password, address }
   */
  static register = asyncHandler(async (req: Request, res: Response) => {
    const { name, email, password, address } = req.body as {
      name: string;
      email: string;
      password: string;
      address: {
        street: string;
        city: string;
        state: string;
        zip: string;
        country: string;
      };
    };

    const { user, tokens } = await UserService.register({
      name,
      email,
      password,
      address,
    });

    setAuthCookies(res, tokens);

    res.status(201).json({
      success: true,
      message: "User registered successfully. Please verify your email.",
      data: user,
    });
  });

  //   Authentication

  /**
   * POST /api/users/login
   * Body: { email, password }
   */
  static login = asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body as Record<string, string>;

    if (!email || !password) {
      throw ValidationError("Email and password are required.");
    }

    const { user, tokens } = await UserService.login(email, password);

    setAuthCookies(res, tokens);

    res.status(200).json({
      success: true,
      message: "Login successful.",
      data: user,
    });
  });

  /**
   * POST /api/users/refresh
   * Uses the refreshToken cookie to issue a new token pair.
   */
  static refreshTokens = asyncHandler(async (req: Request, res: Response) => {
    const refreshToken = req.cookies?.refreshToken as string | undefined;

    if (!refreshToken) {
      throw ValidationError("Refresh token is missing.");
    }

    const tokens = await UserService.refreshTokens(refreshToken);

    setAuthCookies(res, tokens);

    res.status(200).json({
      success: true,
      message: "Tokens refreshed.",
    });
  });

  /**
   * POST /api/users/logout
   * Clears both auth cookies.
   */
  static logout = asyncHandler(async (_req: Request, res: Response) => {
    res.clearCookie("accessToken", COOKIE_OPTIONS);
    res.clearCookie("refreshToken", {
      ...COOKIE_OPTIONS,
      path: "/api/users/refresh",
    });

    res.status(200).json({
      success: true,
      message: "Logged out successfully.",
    });
  });

  //   Email Verification

  /**
   * PATCH /api/users/:userId/verify-email
   */
  static verifyEmail = asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params as { userId: string };

    const user = await UserService.verifyEmail(userId);

    res.status(200).json({
      success: true,
      message: "Email verified. Account is now active.",
      data: user,
    });
  });

  //   Account Status Transitions

  /**
   * PATCH /api/users/:userId/suspend
   * Body: { reason }
   */
  static suspendUser = asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params as { userId: string };
    const { reason } = req.body as { reason: string };

    if (!reason) {
      throw ValidationError("A reason is required to suspend a user.");
    }

    const user = await UserService.suspendUser(userId, reason);

    res.status(200).json({
      success: true,
      message: "User suspended.",
      data: user,
    });
  });

  /**
   * PATCH /api/users/:userId/reactivate
   * Body: { reason }
   */
  static reactivateUser = asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params as { userId: string };
    const { reason } = req.body as { reason: string };

    if (!reason) {
      throw ValidationError("A reason is required to reactivate a user.");
    }

    const user = await UserService.reactivateUser(userId, reason);

    res.status(200).json({
      success: true,
      message: "User reactivated.",
      data: user,
    });
  });

  /**
   * PATCH /api/users/:userId/deactivate
   * Body: { reason }
   */
  static deactivateUser = asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params as { userId: string };
    const { reason } = req.body as { reason: string };

    if (!reason) {
      throw ValidationError("A reason is required to deactivate a user.");
    }

    const user = await UserService.deactivateUser(userId, reason);

    res.status(200).json({
      success: true,
      message: "User deactivated.",
      data: user,
    });
  });

  //   Read Operations

  /**
   * GET /api/users/me
   * Fetches the profile of the currently authenticated user.
   */
  static getMe = asyncHandler(async (req: Request, res: Response) => {
    // req.user is guaranteed to exist here because of authMiddleware
    const userId = req.user!.userId;

    const user = await UserService.getUserById(userId);

    if (!user) {
      throw ValidationError("User not found.");
    }

    res.status(200).json({ success: true, data: user });
  });

  /**
   * GET /api/users/:userId
   */
  static getUserById = asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params as { userId: string };

    const user = await UserService.getUserById(userId);

    if (!user) {
      throw ValidationError("User not found.");
    }

    res.status(200).json({ success: true, data: user });
  });

  /**
   * GET /api/users/email/:email
   */
  static getUserByEmail = asyncHandler(async (req: Request, res: Response) => {
    const { email } = req.params as { email: string };

    const user = await UserService.getUserByEmail(email);

    if (!user) {
      throw ValidationError("User not found.");
    }

    res.status(200).json({ success: true, data: user });
  });

  //   Profile Update

  /**
   * PATCH /api/users/:userId/profile
   * Body: { name?, address? }
   */
  static updateProfile = asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params as { userId: string };
    const { name, address } = req.body as {
      name?: string;
      address?: {
        street: string;
        city: string;
        state: string;
        zip: string;
        country: string;
      };
    };

    if (!name && !address) {
      throw ValidationError(
        "Provide at least one field to update (name or address)."
      );
    }

    const updateData: Parameters<typeof UserService.updateProfile>[1] = {};
    if (name !== undefined) updateData.name = name;
    if (address !== undefined) updateData.address = address;

    const user = await UserService.updateProfile(userId, updateData);

    res.status(200).json({
      success: true,
      message: "Profile updated.",
      data: user,
    });
  });
}
