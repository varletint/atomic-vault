import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { UserService } from "../services/UserService.js";
import { ValidationError } from "../utils/AppError.js";

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
  // 🔘 Registration 🔘

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

    const user = await UserService.register({ name, email, password, address });

    res.status(201).json({
      success: true,
      message: "User registered successfully. Please verify your email.",
      data: user,
    });
  });

  // 🔘 Email Verification 🔘

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

  // 🔘 Account Status Transitions 🔘

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

  // 🔘 Read Operations 🔘

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

  // 🔘 Profile Update 🔘

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

    const user = await UserService.updateProfile(userId, { name, address });

    res.status(200).json({
      success: true,
      message: "Profile updated.",
      data: user,
    });
  });
}
