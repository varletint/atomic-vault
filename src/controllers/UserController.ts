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
export class UserController {}
