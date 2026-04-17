import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { LedgerEntry, Wallet, type ILedgerEntry } from "../models/index.js";
import { NotFoundError, ValidationError } from "../utils/AppError.js";
import { WalletService } from "../services/WalletService.js";
import { ReconciliationService } from "../services/ReconciliationService.js";
import type { z } from "zod";
import type {
  walletLedgerParamsSchema,
  walletLedgerQuerySchema,
  repairBodySchema,
} from "../schemas/walletSchemas.js";

export class WalletController {
  static getStoreWallet = asyncHandler(async (_req: Request, res: Response) => {
    const wallet = await WalletService.getStoreWallet("NGN");

    res.status(200).json({
      success: true,
      data: { wallet },
    });
  });

  static reconcile = asyncHandler(async (req: Request, res: Response) => {
    const { walletId } = req.params as z.infer<typeof walletLedgerParamsSchema>;

    const report = await ReconciliationService.reconcileWallet(walletId);

    res.status(200).json({
      success: true,
      data: report,
    });
  });

  static repair = asyncHandler(async (req: Request, res: Response) => {
    const { dryRun } = (req.body ?? {}) as z.infer<typeof repairBodySchema>;

    const userId = (req as unknown as { userId?: string }).userId;

    const report = await ReconciliationService.repairUnposted({
      actor: userId
        ? {
            type: "ADMIN",
            id: userId as unknown as import("mongoose").Types.ObjectId,
          }
        : { type: "SYSTEM" },
      source: userId ? "reconciliation:admin" : "reconciliation:auto",
      dryRun,
    });

    res.status(200).json({
      success: true,
      data: report,
    });
  });

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
