import mongoose from "mongoose";
import {
  Transaction,
  type ITransaction,
  type TransactionStatus,
  Wallet,
  AuditLog,
} from "../models/index.js";
import { LedgerService } from "./LedgerService.js";
import { TransactionEventService } from "./TransactionEventService.js";
import { OutboxService } from "./OutboxService.js";
import {
  PaystackTransferClient,
  type InitiateTransferResult,
} from "../payments/paystack-transfer.js";
import { CircuitBreaker } from "../utils/CircuitBreaker.js";
import { retryWithBackoff } from "../utils/retryWithBackoff.js";
import { ValidationError, AppError } from "../utils/AppError.js";
import { logger } from "../utils/logger.js";

const WITHDRAWAL_RATE_LIMIT = 1; // max per wallet per hour
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function isTransientFailure(err: unknown): boolean {
  if (
    err instanceof AppError &&
    err.statusCode >= 400 &&
    err.statusCode < 500
  ) {
    return false;
  }
  return true;
}

function isRetryableError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("econnrefused") ||
    msg.includes("socket hang up") ||
    msg.includes("network") ||
    msg.includes("5")
  );
}

const transferCircuitBreaker = new CircuitBreaker({
  name: "PaystackTransfer",
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  windowMs: 60_000,
  timeoutMs: 15_000,
  isFailure: isTransientFailure,
});

const ALLOWED_WITHDRAWAL_TRANSITIONS: Partial<
  Record<TransactionStatus, TransactionStatus[]>
> = {
  INITIATED: ["RESERVED", "FAILED"],
  RESERVED: ["PROCESSING", "UNKNOWN", "FAILED"],
  PROCESSING: ["CONFIRMED", "FAILED", "UNKNOWN"],
  UNKNOWN: ["CONFIRMED", "FAILED"],
};

function assertWithdrawalTransition(
  current: TransactionStatus,
  next: TransactionStatus
): void {
  const allowed = ALLOWED_WITHDRAWAL_TRANSITIONS[current];
  if (!allowed || !allowed.includes(next)) {
    throw ValidationError(
      `Invalid withdrawal transition: ${current} → ${next}`
    );
  }
}

type ActorRef = {
  type: "SYSTEM" | "ADMIN" | "USER";
  id?: mongoose.Types.ObjectId;
};

export type InitiateWithdrawalParams = {
  walletId: string;
  amount: number;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  reason?: string;
  actor: ActorRef;
  idempotencyKey: string;
};

export type InitiateWithdrawalResult = {
  transactionId: string;
  status: TransactionStatus;
  amount: number;
};

export class WithdrawalService {
  /**
   * Step 1 — Synchronous: validate, rate-limit, reserve funds, enqueue outbox.
   * Returns immediately with 202-style response.
   */
  static async initiateWithdrawal(
    params: InitiateWithdrawalParams
  ): Promise<InitiateWithdrawalResult> {
    const {
      walletId,
      amount,
      bankCode,
      accountNumber,
      accountName,
      reason,
      actor,
      idempotencyKey,
    } = params;

    if (!Number.isInteger(amount) || amount < 1) {
      throw ValidationError("Amount must be a positive integer (kobo).");
    }

    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
    const recentCount = await Transaction.countDocuments({
      type: "PAYOUT",
      order: new mongoose.Types.ObjectId(walletId),
      createdAt: { $gte: windowStart },
      status: { $nin: ["FAILED"] },
    });

    if (recentCount >= WITHDRAWAL_RATE_LIMIT) {
      throw ValidationError(
        `Rate limit exceeded: maximum ${WITHDRAWAL_RATE_LIMIT} withdrawal per hour.`
      );
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const wallet = await Wallet.findById(walletId).session(session);
      if (!wallet) throw ValidationError("Wallet not found.");
      if (wallet.status === "FROZEN") {
        throw ValidationError("Wallet is frozen.");
      }
      if (wallet.available < amount) {
        throw ValidationError("Insufficient available balance.");
      }

      const [tx] = await Transaction.create(
        [
          {
            type: "PAYOUT" as const,
            order: wallet._id,
            amount,
            currency: wallet.currency,
            status: "INITIATED" as const,
            paymentMethod: "BANK_TRANSFER" as const,
            provider: "paystack",
            idempotencyKey,
            metadata: {
              bankCode,
              accountNumber,
              accountName,
              reason: reason ?? "Withdrawal",
            },
          },
        ],
        { session }
      );
      if (!tx) throw ValidationError("Failed to create payout transaction.");

      /* Reserve: DR WALLET_AVAILABLE / CR WALLET_PENDING */
      await LedgerService.postWithdrawalReserve({
        session,
        transactionId: tx._id.toString(),
        walletId: wallet._id.toString(),
        amount,
        currency: wallet.currency,
        actor,
        source: "withdrawal:initiate",
        traceId: `withdraw:${tx._id.toString()}`,
      });

      tx.status = "RESERVED";
      await tx.save({ session });

      await TransactionEventService.record({
        session,
        transactionId: tx._id.toString(),
        previousStatus: "INITIATED",
        newStatus: "RESERVED",
        reason: "funds_reserved",
        actor,
        source: "withdrawal:initiate",
        traceId: `withdraw:${tx._id.toString()}`,
      });

      await OutboxService.enqueue(
        {
          type: "WITHDRAWAL_RESERVED",
          dedupeKey: `withdraw:${tx._id.toString()}:reserved`,
          payload: {
            transactionId: tx._id.toString(),
            walletId: wallet._id.toString(),
            amount,
            currency: wallet.currency,
            bankCode,
            accountNumber,
            accountName,
            reason: reason ?? "Withdrawal",
          },
        },
        session
      );

      await AuditLog.create(
        [
          {
            action: "WITHDRAWAL_INITIATED",
            actor: {
              userId: actor.id,
              isSystem: actor.type === "SYSTEM",
              role: actor.type,
            },
            entity: { type: "Transaction", id: tx._id },
            metadata: { amount, walletId, bankCode, accountNumber },
            severity: "warning",
          },
        ],
        { session }
      );

      await session.commitTransaction();

      return {
        transactionId: tx._id.toString(),
        status: tx.status,
        amount,
      };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  /**
   * Step 2 — Async (outbox worker): call Paystack Transfer API through circuit breaker.
   */
  static async processWithdrawalTransfer(transactionId: string): Promise<void> {
    const tx = await Transaction.findById(transactionId);
    if (!tx) throw ValidationError("Transaction not found.");

    if (tx.status !== "RESERVED") {
      logger.info(
        `[Withdrawal] Skipping tx ${transactionId} — status is ${tx.status}, not RESERVED.`
      );
      return;
    }

    const meta = tx.metadata as {
      bankCode: string;
      accountNumber: string;
      accountName: string;
      reason: string;
      recipientCode?: string;
    };

    try {
      let recipientCode = meta.recipientCode;
      if (!recipientCode) {
        const recipient = await transferCircuitBreaker.exec(() =>
          retryWithBackoff(
            () =>
              PaystackTransferClient.createRecipient({
                bankCode: meta.bankCode,
                accountNumber: meta.accountNumber,
                name: meta.accountName,
              }),
            {
              maxRetries: 2,
              name: "createRecipient",
              retryable: isRetryableError,
            }
          )
        );
        recipientCode = recipient.recipientCode;

        await Transaction.updateOne(
          { _id: tx._id },
          { $set: { "metadata.recipientCode": recipientCode } }
        );
      }

      /* Initiate transfer */
      const result: InitiateTransferResult = await transferCircuitBreaker.exec(
        () =>
          retryWithBackoff(
            () =>
              PaystackTransferClient.initiateTransfer({
                amount: tx.amount,
                recipientCode: recipientCode!,
                reference: tx.idempotencyKey,
                reason: meta.reason,
                currency: tx.currency,
              }),
            {
              maxRetries: 2,
              name: "initiateTransfer",
              retryable: isRetryableError,
            }
          )
      );

      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        const freshTx = await Transaction.findById(tx._id).session(session);
        if (!freshTx || freshTx.status !== "RESERVED") {
          await session.abortTransaction();
          return;
        }

        assertWithdrawalTransition(freshTx.status, "PROCESSING");
        freshTx.status = "PROCESSING";
        freshTx.providerRef = result.transferCode;
        await freshTx.save({ session });

        await TransactionEventService.record({
          session,
          transactionId: tx._id.toString(),
          previousStatus: "RESERVED",
          newStatus: "PROCESSING",
          reason: "transfer_initiated",
          actor: { type: "SYSTEM" },
          source: "withdrawal:process",
          traceId: `withdraw:${tx._id.toString()}`,
          metadata: { transferCode: result.transferCode },
        });

        await session.commitTransaction();
      } catch (err) {
        await session.abortTransaction();
        throw err;
      } finally {
        session.endSession();
      }

      logger.info(
        `[Withdrawal] Transfer initiated for tx ${transactionId} — transferCode: ${result.transferCode}`
      );
    } catch (err) {
      logger.error(
        `[Withdrawal] Failed to initiate transfer for tx ${transactionId}`,
        {
          error: String(err),
        }
      );

      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        const freshTx = await Transaction.findById(tx._id).session(session);
        if (!freshTx || freshTx.status !== "RESERVED") {
          await session.abortTransaction();
          return;
        }

        assertWithdrawalTransition(freshTx.status, "UNKNOWN");
        freshTx.status = "UNKNOWN";
        freshTx.failureReason = String(err);
        await freshTx.save({ session });

        await TransactionEventService.record({
          session,
          transactionId: tx._id.toString(),
          previousStatus: "RESERVED",
          newStatus: "UNKNOWN",
          reason: "transfer_initiation_failed",
          actor: { type: "SYSTEM" },
          source: "withdrawal:process",
          traceId: `withdraw:${tx._id.toString()}`,
          metadata: { error: String(err) },
        });

        await session.commitTransaction();
      } catch (innerErr) {
        await session.abortTransaction();
        logger.error(
          `[Withdrawal] Failed to transition tx ${transactionId} to UNKNOWN`,
          { error: String(innerErr) }
        );
      } finally {
        session.endSession();
      }
    }
  }

  static async confirmWithdrawal(reference: string): Promise<void> {
    const tx = await Transaction.findOne({
      idempotencyKey: reference,
      type: "PAYOUT",
    });

    if (!tx) {
      logger.warn(
        `[Withdrawal] confirmWithdrawal: no PAYOUT tx found for reference=${reference}`
      );
      return;
    }

    if (tx.status === "CONFIRMED") return;

    if (tx.status !== "PROCESSING" && tx.status !== "UNKNOWN") {
      logger.warn(
        `[Withdrawal] confirmWithdrawal: tx ${tx._id} in unexpected state ${tx.status}`
      );
      return;
    }

    const walletId = tx.order.toString();
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const freshTx = await Transaction.findById(tx._id).session(session);
      if (
        !freshTx ||
        (freshTx.status !== "PROCESSING" && freshTx.status !== "UNKNOWN")
      ) {
        await session.abortTransaction();
        return;
      }

      await LedgerService.postWithdrawalConfirm({
        session,
        transactionId: freshTx._id.toString(),
        walletId,
        amount: freshTx.amount,
        currency: freshTx.currency,
        actor: { type: "SYSTEM" },
        source: "withdrawal:confirm",
        traceId: `withdraw:${freshTx._id.toString()}`,
      });

      const previousStatus = freshTx.status;
      freshTx.status = "CONFIRMED";
      freshTx.paidAt = new Date();
      freshTx.postedAt = new Date();
      await freshTx.save({ session });

      await TransactionEventService.record({
        session,
        transactionId: freshTx._id.toString(),
        previousStatus,
        newStatus: "CONFIRMED",
        reason: "transfer_success",
        actor: { type: "SYSTEM" },
        source: "withdrawal:confirm",
        traceId: `withdraw:${freshTx._id.toString()}`,
      });

      await AuditLog.create(
        [
          {
            action: "WITHDRAWAL_CONFIRMED",
            actor: { isSystem: true, role: "SYSTEM" },
            entity: { type: "Transaction", id: freshTx._id },
            metadata: { amount: freshTx.amount, walletId },
            severity: "info",
          },
        ],
        { session }
      );

      await session.commitTransaction();
      logger.info(`[Withdrawal] Confirmed tx ${freshTx._id.toString()}`);
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  static async failWithdrawal(
    reference: string,
    reason: string
  ): Promise<void> {
    const tx = await Transaction.findOne({
      idempotencyKey: reference,
      type: "PAYOUT",
    });

    if (!tx) {
      logger.warn(
        `[Withdrawal] failWithdrawal: no PAYOUT tx found for reference=${reference}`
      );
      return;
    }

    if (tx.status === "FAILED") return;

    if (
      tx.status !== "PROCESSING" &&
      tx.status !== "UNKNOWN" &&
      tx.status !== "RESERVED"
    ) {
      logger.warn(
        `[Withdrawal] failWithdrawal: tx ${tx._id} in unexpected state ${tx.status}`
      );
      return;
    }

    const walletId = tx.order.toString();

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const freshTx = await Transaction.findById(tx._id).session(session);
      if (
        !freshTx ||
        (freshTx.status !== "PROCESSING" &&
          freshTx.status !== "UNKNOWN" &&
          freshTx.status !== "RESERVED")
      ) {
        await session.abortTransaction();
        return;
      }

      await LedgerService.postWithdrawalFailure({
        session,
        transactionId: freshTx._id.toString(),
        walletId,
        amount: freshTx.amount,
        currency: freshTx.currency,
        actor: { type: "SYSTEM" },
        source: "withdrawal:fail",
        traceId: `withdraw:${freshTx._id.toString()}`,
      });

      const previousStatus = freshTx.status;
      freshTx.status = "FAILED";
      freshTx.failureReason = reason;
      await freshTx.save({ session });

      await TransactionEventService.record({
        session,
        transactionId: freshTx._id.toString(),
        previousStatus,
        newStatus: "FAILED",
        reason,
        actor: { type: "SYSTEM" },
        source: "withdrawal:fail",
        traceId: `withdraw:${freshTx._id.toString()}`,
      });

      await AuditLog.create(
        [
          {
            action: "WITHDRAWAL_FAILED",
            actor: { isSystem: true, role: "SYSTEM" },
            entity: { type: "Transaction", id: freshTx._id },
            metadata: { amount: freshTx.amount, walletId, reason },
            severity: "warning",
          },
        ],
        { session }
      );

      await session.commitTransaction();
      logger.info(
        `[Withdrawal] Failed tx ${freshTx._id.toString()} — reason: ${reason}`
      );
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }
}
