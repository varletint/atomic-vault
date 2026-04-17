import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { LedgerEntry, Wallet, type ILedgerEntry } from "../models/index.js";
import { NotFoundError, ValidationError } from "../utils/AppError.js";
import type { z } from "zod";
import type {
  walletLedgerParamsSchema,
  walletLedgerQuerySchema,
} from "../schemas/walletSchemas.js";

export class WalletController {
  static getLedger = asyncHandler(async (req: Request, res: Response) => {
    const { walletId } = req.params as z.infer<typeof walletLedgerParamsSchema>;
    const { page, limit, from, to } = req.query as unknown as z.infer<
      typeof walletLedgerQuerySchema
    >;

    if (from && to && from > to) {
      throw ValidationError("`from` date cannot be after `to` date.");
    }

    const wallet = await Wallet.findById(walletId).lean();
    if (!wallet) throw NotFoundError("Wallet");

    const skip = (page - 1) * limit;
    const filter: Record<string, unknown> = { walletId: wallet._id };
    if (from || to) {
      filter.createdAt = {};
      if (from) (filter.createdAt as Record<string, unknown>).$gte = from;
      if (to) (filter.createdAt as Record<string, unknown>).$lte = to;
    }

    const [entries, total] = await Promise.all([
      LedgerEntry.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean<ILedgerEntry[]>(),
      LedgerEntry.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: {
        wallet,
        entries,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  });
}

