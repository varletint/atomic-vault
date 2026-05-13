import mongoose from "mongoose";
import {
  RefundRequest,
  type IRefundRequest,
  type RefundStatus,
  ALLOWED_REFUND_TRANSITIONS,
  MAX_REQUEUE_COUNT,
  Transaction,
  LedgerEntry,
  AuditLog,
  Order,
  type OrderStatus,
  type ILedgerActorRef,
} from "../models/index.js";
import { LedgerService } from "./LedgerService.js";
import { OutboxService } from "./OutboxService.js";
import { OutboxProcessor } from "./OutboxProcessor.js";
import { resolveGateway } from "../payments/index.js";
import { CircuitBreaker } from "../utils/CircuitBreaker.js";
import { ValidationError, AppError } from "../utils/AppError.js";
import { logger } from "../utils/logger.js";
import { formatMinorCurrency } from "../utils/currency.js";

const AUTO_APPROVE_THRESHOLD_KOBO = 40_000_00;

const MAX_GATEWAY_RETRIES = 5;

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

const refundCircuitBreaker = new CircuitBreaker({
  name: "PaystackRefund",
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  windowMs: 60_000,
  timeoutMs: 15_000,
  isFailure: isTransientFailure,
});

function assertRefundTransition(
  current: RefundStatus,
  next: RefundStatus
): void {
  const allowed = ALLOWED_REFUND_TRANSITIONS[current];
  if (!allowed.includes(next)) {
    throw ValidationError(`Invalid refund transition: ${current} → ${next}`);
  }
}

async function transitionRefund(
  refund: IRefundRequest,
  next: RefundStatus,
  session: mongoose.ClientSession,
  opts?: {
    note?: string;
    actor?: { type: string; id?: mongoose.Types.ObjectId };
  }
): Promise<void> {
  assertRefundTransition(refund.status as RefundStatus, next);
  refund.status = next;
  refund.statusHistory.push({
    status: next,
    timestamp: new Date(),
    note: opts?.note,
    actor: opts?.actor as IRefundRequest["statusHistory"][0]["actor"],
  });
  await refund.save({ session });
}

export class RefundService {
  static async createRefundRequest(params: {
    orderId: string;
    userId?: string | null;
    session: mongoose.ClientSession;
  }): Promise<IRefundRequest | null> {
    const { orderId, userId, session } = params;

    const tx = await Transaction.findOne({
      order: new mongoose.Types.ObjectId(orderId),
      status: "CONFIRMED",
      type: "ORDER_PAYMENT",
    }).session(session);

    if (!tx) return null;

    const existing = await RefundRequest.findOne({
      originalTransactionId: tx._id,
    }).session(session);
    if (existing) return existing;

    const [refundReq] = await RefundRequest.create(
      [
        {
          orderId: new mongoose.Types.ObjectId(orderId),
          userId: userId ? new mongoose.Types.ObjectId(userId) : undefined,
          originalTransactionId: tx._id,
          originalAmount: tx.amount,
          deductionAmount: 0,
          refundAmount: tx.amount,
          status: "REQUESTED",
          statusHistory: [
            {
              status: "REQUESTED",
              timestamp: new Date(),
              note: "Refund request created on order cancellation",
              actor: { type: "SYSTEM" },
            },
          ],
        },
      ],
      { session }
    );

    if (!refundReq) throw ValidationError("Failed to create refund request.");

    await OutboxService.enqueue(
      {
        type: "REFUND_REQUESTED",
        dedupeKey: `refund:${refundReq._id.toString()}:requested`,
        payload: { refundRequestId: refundReq._id.toString() },
      },
      session
    );

    return refundReq;
  }

  /**
   * Validate the refund request from (outbox handler for REFUND_REQUESTED).
   */
  static async validateRefund(refundRequestId: string): Promise<void> {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const refund = await RefundRequest.findById(refundRequestId).session(
        session
      );
      if (!refund) throw ValidationError("Refund request not found.");
      if (refund.status !== "REQUESTED") {
        await session.commitTransaction();
        return;
      }

      const tx = await Transaction.findById(
        refund.originalTransactionId
      ).session(session);

      if (!tx || tx.status !== "CONFIRMED") {
        await transitionRefund(refund, "REJECTED", session, {
          note: "Original transaction not found or not confirmed",
          actor: { type: "SYSTEM" },
        });
        await OutboxService.enqueue(
          {
            type: "REFUND_VALIDATION_FAILED",
            dedupeKey: `refund:${refundRequestId}:validation_failed`,
            payload: {
              refundRequestId,
              reason: "Original transaction invalid",
            },
          },
          session
        );
        await session.commitTransaction();
        return;
      }

      await transitionRefund(refund, "PENDING_APPROVAL", session, {
        note: "Validation passed",
        actor: { type: "SYSTEM" },
      });

      await OutboxService.enqueue(
        {
          type: "REFUND_VALIDATED",
          dedupeKey: `refund:${refundRequestId}:validated`,
          payload: { refundRequestId },
        },
        session
      );

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  /**
   * Evaluate auto-approval from (outbox handler for REFUND_VALIDATED).
   */
  static async evaluateApproval(refundRequestId: string): Promise<void> {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const refund = await RefundRequest.findById(refundRequestId).session(
        session
      );
      if (!refund) throw ValidationError("Refund request not found.");
      if (refund.status !== "PENDING_APPROVAL") {
        await session.commitTransaction();
        return;
      }

      // Auto-approve: transition to PROCESSING if requested refund amount is less than the approval
      // threshold amount(ledger posts at settlement)
      if (refund.refundAmount <= AUTO_APPROVE_THRESHOLD_KOBO) {
        await transitionRefund(refund, "PROCESSING", session, {
          note: `Auto-approved (≤ ${formatMinorCurrency(
            AUTO_APPROVE_THRESHOLD_KOBO
          )})`,
          actor: { type: "SYSTEM" },
        });
        await OutboxService.enqueue(
          {
            type: "REFUND_APPROVED",
            dedupeKey: `refund:${refundRequestId}:approved`,
            payload: { refundRequestId },
          },
          session
        );
      } else {
        await transitionRefund(refund, "AWAITING_REVIEW", session, {
          note: `Requires admin review (> ${formatMinorCurrency(
            AUTO_APPROVE_THRESHOLD_KOBO
          )})`,
          actor: { type: "SYSTEM" },
        });
      }

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  /**
   * Admin approves a refund (with optional deduction).
   */
  static async approveRefund(params: {
    refundRequestId: string;
    deductionAmount?: number;
    deductionReason?: string;
    adminId: string;
  }): Promise<IRefundRequest> {
    const {
      refundRequestId,
      deductionAmount = 0,
      deductionReason,
      adminId,
    } = params;

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const refund = await RefundRequest.findById(refundRequestId).session(
        session
      );
      if (!refund) throw ValidationError("Refund request not found.");
      if (refund.status !== "AWAITING_REVIEW") {
        throw ValidationError(
          `Cannot approve refund in status ${refund.status}.`
        );
      }

      if (deductionAmount < 0 || deductionAmount >= refund.originalAmount) {
        throw ValidationError(
          "Deduction must be >= 0 and less than original amount."
        );
      }

      refund.deductionAmount = deductionAmount;
      refund.deductionReason = deductionReason;
      refund.refundAmount = refund.originalAmount - deductionAmount;
      refund.reviewedBy = new mongoose.Types.ObjectId(adminId);
      refund.reviewedAt = new Date();
      await refund.save({ session });

      // Ledger posts at SETTLED → COMPLETED
      await transitionRefund(refund, "PROCESSING", session, {
        note:
          deductionAmount > 0
            ? `Approved with deduction of ${formatMinorCurrency(
                deductionAmount
              )}: ${deductionReason}`
            : "Approved — full refund",
        actor: { type: "ADMIN", id: new mongoose.Types.ObjectId(adminId) },
      });

      await OutboxService.enqueue(
        {
          type: "REFUND_APPROVED",
          dedupeKey: `refund:${refundRequestId}:approved`,
          payload: { refundRequestId },
        },
        session
      );

      await AuditLog.create(
        [
          {
            action: "REFUND_APPROVED",
            actor: {
              userId: new mongoose.Types.ObjectId(adminId),
              isSystem: false,
              role: "ADMIN",
            },
            entity: { type: "Transaction", id: refund.originalTransactionId },
            metadata: {
              refundRequestId,
              originalAmount: refund.originalAmount,
              deductionAmount,
              refundAmount: refund.refundAmount,
              deductionReason,
            },
            severity: "warning",
          },
        ],
        { session }
      );

      await session.commitTransaction();
      OutboxProcessor.scheduleDrain();
      return refund;
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  /**
   * Admin rejects a refund.
   */
  static async rejectRefund(params: {
    refundRequestId: string;
    reason: string;
    adminId: string;
  }): Promise<IRefundRequest> {
    const { refundRequestId, reason, adminId } = params;

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const refund = await RefundRequest.findById(refundRequestId).session(
        session
      );
      if (!refund) throw ValidationError("Refund request not found.");
      if (
        refund.status !== "AWAITING_REVIEW" &&
        refund.status !== "PENDING_APPROVAL"
      ) {
        throw ValidationError(
          `Cannot reject refund in status ${refund.status}.`
        );
      }

      refund.rejectionReason = reason;
      refund.reviewedBy = new mongoose.Types.ObjectId(adminId);
      refund.reviewedAt = new Date();

      await transitionRefund(refund, "REJECTED", session, {
        note: `Rejected: ${reason}`,
        actor: { type: "ADMIN", id: new mongoose.Types.ObjectId(adminId) },
      });

      await AuditLog.create(
        [
          {
            action: "REFUND_REJECTED",
            actor: {
              userId: new mongoose.Types.ObjectId(adminId),
              isSystem: false,
              role: "ADMIN",
            },
            entity: { type: "Transaction", id: refund.originalTransactionId },
            metadata: { refundRequestId, reason },
            severity: "warning",
          },
        ],
        { session }
      );

      await session.commitTransaction();
      return refund;
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  /**
   * Dispatch refund to Paystack via CB (outbox handler for REFUND_APPROVED).
   *
   * - Atomic claim via findOneAndUpdate prevents double-dispatch.
   * - Single CB call per attempt — outbox handles retries.
   * - RETRYING persists as an observable state until next outbox cycle.
   */
  static async dispatchToGateway(refundRequestId: string): Promise<void> {
    const claimed = await RefundRequest.findOneAndUpdate(
      { _id: refundRequestId, status: "PROCESSING" },
      { $set: { updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!claimed) {
      logger.info(
        `[Refund] Skipping dispatch ${refundRequestId} — already claimed or not PROCESSING.`
      );
      return;
    }

    const tx = await Transaction.findById(claimed.originalTransactionId);
    if (!tx) throw ValidationError("Original transaction not found.");

    const gateway = resolveGateway(tx.provider);
    if (!gateway.refund) {
      throw ValidationError(
        `Provider ${tx.provider} does not support refunds.`
      );
    }

    try {
      // Single CB-wrapped call — no inner retryWithBackoff
      const result = await refundCircuitBreaker.exec(() =>
        gateway.refund!({
          transactionRef: tx.providerRef ?? tx.idempotencyKey,
          amount: claimed.refundAmount,
          currency: tx.currency,
        })
      );

      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        const freshRefund = await RefundRequest.findById(
          refundRequestId
        ).session(session);
        if (!freshRefund || freshRefund.status !== "PROCESSING") {
          await session.abortTransaction();
          return;
        }

        freshRefund.providerRefundRef = result.providerRefundRef;
        await transitionRefund(freshRefund, "GATEWAY_PENDING", session, {
          note: `Dispatched to gateway — ref: ${result.providerRefundRef}`,
          actor: { type: "SYSTEM" },
        });

        await OutboxService.enqueue(
          {
            type: "REFUND_DISPATCHED",
            dedupeKey: `refund:${refundRequestId}:dispatched`,
            payload: {
              refundRequestId,
              transactionRef: tx.providerRef ?? tx.idempotencyKey,
              refundAmount: claimed.refundAmount,
              currency: tx.currency,
            },
          },
          session
        );

        await session.commitTransaction();
      } catch (innerErr) {
        await session.abortTransaction();
        throw innerErr;
      } finally {
        session.endSession();
      }
    } catch (err) {
      // Gateway failed — RETRYING (persistent) or FAILED (terminal)
      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        const freshRefund = await RefundRequest.findById(
          refundRequestId
        ).session(session);
        if (!freshRefund || freshRefund.status !== "PROCESSING") {
          await session.abortTransaction();
          return;
        }

        freshRefund.retryCount += 1;
        freshRefund.lastError =
          err instanceof Error ? err.message : String(err);

        if (freshRefund.retryCount >= MAX_GATEWAY_RETRIES) {
          await transitionRefund(freshRefund, "FAILED", session, {
            note: `Exhausted ${MAX_GATEWAY_RETRIES} retries: ${freshRefund.lastError}`,
            actor: { type: "SYSTEM" },
          });
          await OutboxService.enqueue(
            {
              type: "REFUND_RETRY_EXHAUSTED",
              dedupeKey: `refund:${refundRequestId}:exhausted`,
              payload: {
                refundRequestId,
                error: freshRefund.lastError ?? "Unknown",
              },
            },
            session
          );
        } else {
          // RETRYING persists — queryable by ops dashboards
          await transitionRefund(freshRefund, "RETRYING", session, {
            note: `Attempt ${freshRefund.retryCount}/${MAX_GATEWAY_RETRIES}: ${freshRefund.lastError}`,
            actor: { type: "SYSTEM" },
          });
          // Outbox picks this up on the next cycle
          await OutboxService.enqueue(
            {
              type: "REFUND_GATEWAY_TIMEOUT",
              dedupeKey: `refund:${refundRequestId}:retry:${freshRefund.retryCount}`,
              payload: {
                refundRequestId,
                error: freshRefund.lastError ?? "Unknown",
              },
            },
            session
          );
        }

        await session.commitTransaction();
      } catch (innerErr) {
        await session.abortTransaction();
        logger.error(
          `[Refund] Failed to transition refund ${refundRequestId}`,
          { error: String(innerErr) }
        );
      } finally {
        session.endSession();
      }
    }
  }

  /**
   * Handle Paystack refund.processed webhook.
   * Owns the lookup by providerRefundRef — controller passes the raw ref.
   */
  static async handleRefundSettled(providerRefundRef: string): Promise<void> {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const refund = await RefundRequest.findOne({
        providerRefundRef,
        status: "GATEWAY_PENDING",
      }).session(session);

      if (!refund) {
        await session.commitTransaction();
        return;
      }

      await transitionRefund(refund, "SETTLED", session, {
        note: `Settled by gateway — ref: ${providerRefundRef}`,
        actor: { type: "SYSTEM" },
      });

      await OutboxService.enqueue(
        {
          type: "REFUND_SETTLED",
          dedupeKey: `refund:${refund._id.toString()}:settled`,
          payload: {
            refundRequestId: refund._id.toString(),
            providerRefundRef,
          },
        },
        session
      );

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  /**
   * Complete the refund (outbox handler for REFUND_SETTLED).
   */
  static async completeRefund(refundRequestId: string): Promise<void> {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const refund = await RefundRequest.findById(refundRequestId).session(
        session
      );
      if (!refund) throw ValidationError("Refund request not found.");
      if (refund.status !== "SETTLED") {
        await session.commitTransaction();
        return;
      }

      refund.completedAt = new Date();

      // Post ledger entries only after gateway settlement confirms money moved
      await this.postRefundLedgerEntries(refund, session);

      await transitionRefund(refund, "COMPLETED", session, {
        note: "Refund completed — ledger posted, customer notified",
        actor: { type: "SYSTEM" },
      });

      // Transition the parent order CANCELLED → REFUNDED
      const order = await Order.findById(refund.orderId).session(session);
      if (order && order.status === "CANCELLED") {
        order.status = "REFUNDED" as OrderStatus;
        order.statusHistory.push({
          status: "REFUNDED" as OrderStatus,
          timestamp: new Date(),
          note: `Refund completed — ${formatMinorCurrency(
            refund.refundAmount
          )} returned to customer`,
        });
        await order.save({ session });
      }

      await OutboxService.enqueue(
        {
          type: "REFUND_COMPLETED",
          dedupeKey: `refund:${refundRequestId}:completed`,
          payload: { refundRequestId },
        },
        session
      );

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  /**
   * Admin requeues a FAILED refund back to PROCESSING.
   * Capped at MAX_REQUEUE_COUNT to prevent infinite manual retries.
   */
  static async requeueFailed(params: {
    refundRequestId: string;
    adminId: string;
  }): Promise<IRefundRequest> {
    const { refundRequestId, adminId } = params;

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const refund = await RefundRequest.findById(refundRequestId).session(
        session
      );
      if (!refund) throw ValidationError("Refund request not found.");
      if (refund.status !== "FAILED") {
        throw ValidationError(
          `Cannot requeue refund in status ${refund.status}.`
        );
      }

      if (refund.requeueCount >= MAX_REQUEUE_COUNT) {
        throw ValidationError(
          `Requeue limit reached (${MAX_REQUEUE_COUNT}). This refund requires manual resolution.`
        );
      }

      refund.retryCount = 0;
      refund.requeueCount += 1;
      refund.lastError = undefined;

      await transitionRefund(refund, "PROCESSING", session, {
        note: `Requeued by admin (${refund.requeueCount}/${MAX_REQUEUE_COUNT})`,
        actor: { type: "ADMIN", id: new mongoose.Types.ObjectId(adminId) },
      });

      await OutboxService.enqueue(
        {
          type: "REFUND_APPROVED",
          dedupeKey: `refund:${refundRequestId}:requeue:${Date.now()}`,
          payload: { refundRequestId },
        },
        session
      );

      await AuditLog.create(
        [
          {
            action: "REFUND_REQUEUED",
            actor: {
              userId: new mongoose.Types.ObjectId(adminId),
              isSystem: false,
              role: "ADMIN",
            },
            entity: { type: "Transaction", id: refund.originalTransactionId },
            metadata: {
              refundRequestId,
              requeueCount: refund.requeueCount,
              maxRequeueCount: MAX_REQUEUE_COUNT,
            },
            severity: "warning",
          },
        ],
        { session }
      );

      await session.commitTransaction();
      OutboxProcessor.scheduleDrain();
      return refund;
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  /**
   * Transitions RETRYING → PROCESSING and re-dispatches to gateway.
   * Called by the REFUND_GATEWAY_TIMEOUT outbox handler.
   */
  static async retryFromRetrying(refundRequestId: string): Promise<void> {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const refund = await RefundRequest.findById(refundRequestId).session(
        session
      );
      if (!refund) throw ValidationError("Refund request not found.");
      if (refund.status !== "RETRYING") {
        await session.commitTransaction();
        return; // idempotent
      }

      await transitionRefund(refund, "PROCESSING", session, {
        note: "Re-entering PROCESSING from RETRYING",
        actor: { type: "SYSTEM" },
      });

      await OutboxService.enqueue(
        {
          type: "REFUND_APPROVED",
          dedupeKey: `refund:${refundRequestId}:retry-dispatch:${refund.retryCount}`,
          payload: { refundRequestId },
        },
        session
      );

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  /* ── Internal helpers ── */

  /**
   * Posts ledger entries for the refund (and deduction if any).
   */
  private static async postRefundLedgerEntries(
    refund: IRefundRequest,
    session: mongoose.ClientSession
  ): Promise<void> {
    const idempotencyKey = `refund:${refund._id.toString()}`;

    const existingRefundTx = await Transaction.findOne({
      idempotencyKey,
    }).session(session);

    if (existingRefundTx) {
      refund.refundTransactionId = existingRefundTx._id;
      await refund.save({ session });
      return;
    }

    const tx = await Transaction.findById(refund.originalTransactionId).session(
      session
    );
    if (!tx) throw ValidationError("Original transaction not found.");

    const originalEntry = await LedgerEntry.findOne({
      transactionId: tx._id,
    })
      .session(session)
      .lean();

    if (!originalEntry) {
      throw ValidationError(
        "No ledger entries found for original transaction."
      );
    }

    const [refundTx] = await Transaction.create(
      [
        {
          type: "REFUND" as const,
          order: tx.order,
          user: tx.user,
          amount: refund.refundAmount,
          currency: tx.currency,
          status: "CONFIRMED" as const,
          paymentMethod: tx.paymentMethod,
          provider: tx.provider,
          providerRef: tx.providerRef,
          idempotencyKey,
          postedAt: new Date(),
          paidAt: new Date(),
          metadata: {
            originalTransactionId: tx._id.toString(),
            deductionAmount: refund.deductionAmount,
            deductionReason: refund.deductionReason,
          },
        },
      ],
      { session }
    );
    if (!refundTx)
      throw ValidationError("Failed to create refund transaction.");

    refund.refundTransactionId = refundTx._id;
    await refund.save({ session });

    const actor: ILedgerActorRef = refund.reviewedBy
      ? { type: "ADMIN", id: refund.reviewedBy }
      : { type: "SYSTEM" };

    await LedgerService.postRefundJournal({
      session,
      transactionId: refundTx._id.toString(),
      currency: tx.currency,
      refundAmount: refund.refundAmount,
      deductionAmount: refund.deductionAmount,
      deductionReason: refund.deductionReason,
      originalPostingId: originalEntry.postingId,
      actor,
      source: "refund:settle",
      traceId: `refund:${refund._id.toString()}`,
    });
  }
}
