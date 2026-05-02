import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { Settlement, type ISettlement } from "../models/index.js";
import { NotFoundError } from "../utils/AppError.js";

export class SettlementController {
  static list = asyncHandler(async (req: Request, res: Response) => {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit as string, 10) || 20)
    );
    const status = req.query.status as string | undefined;

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;

    const skip = (page - 1) * limit;
    const [settlements, total] = await Promise.all([
      Settlement.find(filter)
        .sort({ settledAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean<ISettlement[]>(),
      Settlement.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: {
        settlements,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  });

  static getById = asyncHandler(async (req: Request, res: Response) => {
    const { settlementId } = req.params;

    const settlement = await Settlement.findById(
      settlementId
    ).lean<ISettlement>();
    if (!settlement) throw NotFoundError("Settlement");

    res.status(200).json({
      success: true,
      data: settlement,
    });
  });
}
