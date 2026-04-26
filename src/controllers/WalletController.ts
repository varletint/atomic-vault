import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import mongoose from "mongoose";
import { LedgerEntry, Wallet, type ILedgerEntry } from "../models/index.js";
import { NotFoundError, ValidationError } from "../utils/AppError.js";
import { WalletService } from "../services/WalletService.js";
import { ReconciliationService } from "../services/ReconciliationService.js";
import { LedgerService } from "../services/LedgerService.js";
import { TransactionEventService } from "../services/TransactionEventService.js";
import { AuditService } from "../services/AuditService.js";
import type { z } from "zod";
import type {
  walletLedgerParamsSchema,
  walletLedgerQuerySchema,
  repairBodySchema,
  reverseParamsSchema,
  reverseBodySchema,
  adjustBodySchema,
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
    const { walletId } = req.params as z.infer<typeof walletLedgerParamsSchema>;
    const { dryRun, confirm } = (req.body ?? {}) as z.infer<
      typeof repairBodySchema
    >;

    /* Non-dry-run repairs require explicit confirmation */
    if (!dryRun && !confirm) {
      throw ValidationError(
        "Destructive operation: set { confirm: true } to proceed, or use { dryRun: true } to preview."
      );
    }

    const userId = req.user?.userId;
    const isValidObjectId =
      typeof userId === "string" && /^[0-9a-fA-F]{24}$/.test(userId);

    const actor = isValidObjectId
      ? { type: "ADMIN" as const, id: new mongoose.Types.ObjectId(userId) }
      : { type: "SYSTEM" as const };
    const source = isValidObjectId
      ? "reconciliation:admin"
      : "reconciliation:auto";

    const report = await ReconciliationService.repairUnposted({
      walletId,
      actor,
      source,
      dryRun,
    });

    /* Audit log */
    await AuditService.log({
      action: "RECONCILIATION_REPAIR",
      actor: AuditService.getActorFromRequest(req),
      entity: { type: "Other", id: walletId, name: "Wallet" },
      request: AuditService.getRequestContext(req),
      result: { success: true },
      metadata: {
        dryRun,
        ...report.summary,
      },
      severity: dryRun ? "info" : "warning",
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

  /** POST /transactions/:transactionId/reverse — admin reversal. */
  static reverse = asyncHandler(async (req: Request, res: Response) => {
    const { transactionId } = req.params as z.infer<typeof reverseParamsSchema>;
    const { reason } = req.body as z.infer<typeof reverseBodySchema>;

    const userId = req.user?.userId;
    const isValidObjectId =
      typeof userId === "string" && /^[0-9a-fA-F]{24}$/.test(userId);

    const actor = isValidObjectId
      ? { type: "ADMIN" as const, id: new mongoose.Types.ObjectId(userId) }
      : { type: "SYSTEM" as const };

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const result = await LedgerService.postReversalJournal({
        session,
        originalTransactionId: transactionId,
        reason,
        actor,
        source: "admin:reverse",
        traceId: `reverse:${transactionId}`,
      });

      await TransactionEventService.record({
        session,
        transactionId,
        previousStatus: "CONFIRMED",
        newStatus: "REVERSED",
        reason,
        actor,
        source: "admin:reverse",
        traceId: `reverse:${transactionId}`,
      });

      await session.commitTransaction();

      /* Audit log (outside session) */
      await AuditService.log({
        action: "TRANSACTION_REVERSED",
        actor: AuditService.getActorFromRequest(req),
        entity: { type: "Transaction", id: transactionId },
        request: AuditService.getRequestContext(req),
        result: { success: true },
        metadata: {
          reason,
          reversalTransactionId: result.reversalTransactionId,
        },
        severity: "warning",
      });

      res.status(200).json({
        success: true,
        data: {
          reversalTransactionId: result.reversalTransactionId,
          originalTransactionId: transactionId,
          reason,
        },
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  });

  /** POST /wallets/:walletId/adjust — admin wallet adjustment. */
  static adjust = asyncHandler(async (req: Request, res: Response) => {
    const { walletId } = req.params as z.infer<typeof walletLedgerParamsSchema>;
    const { direction, amount, reason } = req.body as z.infer<
      typeof adjustBodySchema
    >;

    const userId = req.user?.userId;
    const isValidObjectId =
      typeof userId === "string" && /^[0-9a-fA-F]{24}$/.test(userId);

    const actor = isValidObjectId
      ? { type: "ADMIN" as const, id: new mongoose.Types.ObjectId(userId) }
      : { type: "SYSTEM" as const };

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const result = await LedgerService.postAdjustmentJournal({
        session,
        walletId,
        direction,
        amount,
        currency: "NGN",
        reason,
        actor,
        source: "admin:adjust",
        traceId: `adjust:${walletId}:${Date.now()}`,
      });

      await session.commitTransaction();

      /* Audit log (outside session) */
      await AuditService.log({
        action: "WALLET_ADJUSTED",
        actor: AuditService.getActorFromRequest(req),
        entity: { type: "Other", id: walletId, name: "Wallet" },
        request: AuditService.getRequestContext(req),
        result: { success: true },
        metadata: { direction, amount, reason },
        severity: "warning",
      });

      res.status(200).json({
        success: true,
        data: {
          adjustmentTransactionId: result.adjustmentTransactionId,
          walletId,
          direction,
          amount,
          reason,
        },
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  });
}
