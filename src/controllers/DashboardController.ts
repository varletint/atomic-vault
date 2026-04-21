import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { DashboardService } from "../services/DashboardService.js";

export class DashboardController {
  static getStats = asyncHandler(async (_req: Request, res: Response) => {
    const stats = await DashboardService.getStats();
    res.status(200).json({ success: true, data: stats });
  });
}
