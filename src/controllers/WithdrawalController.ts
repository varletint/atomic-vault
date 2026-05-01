import type { Request, Response } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { Transaction, type ITransaction } from "../models/index.js";
import { WithdrawalService } from "../services/WithdrawalService.js";
import { PaystackTransferClient } from "../payments/paystack-transfer.js";
import { ValidationError, NotFoundError } from "../utils/AppError.js";
import type { z } from "zod";
import type {
  initiateWithdrawalBodySchema,
  withdrawalParamsSchema,
  withdrawalListQuerySchema,
} from "../schemas/withdrawalSchemas.js";

export class WithdrawalController {
  static resolveAccount = asyncHandler(async (req: Request, res: Response) => {
    const bankCode = String(req.query.bank_code ?? "").trim();
    const accountNumber = String(req.query.account_number ?? "").trim();

    if (!bankCode) throw ValidationError("bank_code is required.");
    if (!/^\d{10}$/.test(accountNumber)) {
      throw ValidationError("account_number must be exactly 10 digits.");
    }

    const result = await PaystackTransferClient.resolveAccount({
      accountNumber,
      bankCode,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  });

  static initiate = asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof initiateWithdrawalBodySchema>;

    const userId = req.user?.userId;
    const isValidObjectId =
      typeof userId === "string" && /^[0-9a-fA-F]{24}$/.test(userId);

    const actor = isValidObjectId
      ? {
          type: "ADMIN" as const,
          id: new mongoose.Types.ObjectId(userId),
        }
      : { type: "SYSTEM" as const };

    const result = await WithdrawalService.initiateWithdrawal({
      walletId: body.walletId,
      amount: body.amount,
      bankCode: body.bankCode,
      accountNumber: body.accountNumber,
      accountName: body.accountName,
      reason: body.reason,
      actor,
      idempotencyKey: body.idempotencyKey,
    });

    res.status(202).json({
      success: true,
      message:
        "Withdrawal initiated. Funds have been reserved and will be transferred shortly.",
      data: result,
    });
  });

  static list = asyncHandler(async (req: Request, res: Response) => {
    const { page, limit, status } = req.query as unknown as z.infer<
      typeof withdrawalListQuerySchema
    >;

    const filter: Record<string, unknown> = { type: "PAYOUT" };
    if (status) filter.status = status;

    const skip = (page - 1) * limit;
    const [withdrawals, total] = await Promise.all([
      Transaction.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean<ITransaction[]>(),
      Transaction.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: {
        withdrawals,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  });

  static getById = asyncHandler(async (req: Request, res: Response) => {
    const { withdrawalId } = req.params as z.infer<
      typeof withdrawalParamsSchema
    >;

    const tx = await Transaction.findOne({
      _id: withdrawalId,
      type: "PAYOUT",
    }).lean<ITransaction>();

    if (!tx) throw NotFoundError("Withdrawal");

    res.status(200).json({
      success: true,
      data: tx,
    });
  });
}
