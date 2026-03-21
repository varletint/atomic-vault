import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { UserService } from "../services/UserService.js";
import { ValidationError } from "../utils/AppError.js";
import { parseExpirationToMs } from "../utils/jwt.js";
import type { z } from "zod";
import type {
  registerSchema,
  loginSchema,
  reasonSchema,
  updateProfileSchema,
} from "../schemas/userSchemas.js";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
};

function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
): void {
  res.cookie("accessToken", tokens.accessToken, {
    ...COOKIE_OPTIONS,
    maxAge: parseExpirationToMs(process.env.JWT_ACCESS_EXPIRES_IN || "15m"),
  });

  res.cookie("refreshToken", tokens.refreshToken, {
    ...COOKIE_OPTIONS,
    path: "/api/users/refresh",
    maxAge: parseExpirationToMs(process.env.JWT_REFRESH_EXPIRES_IN || "7d"),
  });
}

export class UserController {
  static register = asyncHandler(async (req: Request, res: Response) => {
    const { name, email, password, address } = req.body as z.infer<
      typeof registerSchema
    >;

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

  static login = asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;

    const { user, tokens } = await UserService.login(email, password, {
      ip: req.ip,
      userAgent: req.get("user-agent") ?? undefined,
    });

    setAuthCookies(res, tokens);

    res.status(200).json({
      success: true,
      message: "Login successful.",
      data: user,
    });
  });

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

  static verifyEmail = asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params as { userId: string };

    const { user, tokens } = await UserService.verifyEmail(userId);

    setAuthCookies(res, tokens);

    res.status(200).json({
      success: true,
      message: "Email verified. Account is now active.",
      data: user,
    });
  });

  static suspendUser = asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params as { userId: string };
    const { reason } = req.body as z.infer<typeof reasonSchema>;

    const user = await UserService.suspendUser(userId, reason);

    res.status(200).json({
      success: true,
      message: "User suspended.",
      data: user,
    });
  });

  static reactivateUser = asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params as { userId: string };
    const { reason } = req.body as z.infer<typeof reasonSchema>;

    const user = await UserService.reactivateUser(userId, reason);

    res.status(200).json({
      success: true,
      message: "User reactivated.",
      data: user,
    });
  });

  static deactivateUser = asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params as { userId: string };
    const { reason } = req.body as z.infer<typeof reasonSchema>;

    const user = await UserService.deactivateUser(userId, reason);

    res.status(200).json({
      success: true,
      message: "User deactivated.",
      data: user,
    });
  });

  static getMe = asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.userId;

    const user = await UserService.getUserById(userId);

    if (!user) {
      throw ValidationError("User not found.");
    }

    res.status(200).json({ success: true, data: user });
  });

  static getUserById = asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params as { userId: string };

    const user = await UserService.getUserById(userId);

    if (!user) {
      throw ValidationError("User not found.");
    }

    res.status(200).json({ success: true, data: user });
  });

  static getUserByEmail = asyncHandler(async (req: Request, res: Response) => {
    const { email } = req.params as { email: string };

    const user = await UserService.getUserByEmail(email);

    if (!user) {
      throw ValidationError("User not found.");
    }

    res.status(200).json({ success: true, data: user });
  });

  static updateProfile = asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params as { userId: string };
    const { name, address } = req.body as z.infer<typeof updateProfileSchema>;

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
