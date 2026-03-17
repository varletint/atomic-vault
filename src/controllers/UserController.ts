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
}
