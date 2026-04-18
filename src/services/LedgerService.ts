import mongoose from "mongoose";
import {
  LedgerEntry,
  Wallet,
  type ILedgerEntryAttrs,
  type LedgerBucket,
  type LedgerDirection,
  type LedgerEntryType,
  type ILedgerActorRef,
  Transaction,
} from "../models/index.js";
import { ValidationError } from "../utils/AppError.js";
import { WalletService } from "./WalletService.js";
import { OutboxService } from "./OutboxService.js";

type LedgerLine = {
  walletId: mongoose.Types.ObjectId;
  currency: string;
  bucket: LedgerBucket;
  direction: LedgerDirection;
  amount: number;
  entryType: LedgerEntryType;
  narration?: string;
  dedupeKey?: string;
};

function deltaFor(direction: LedgerDirection, amount: number): number {
  return direction === "CREDIT" ? amount : -amount;
}

export class LedgerService {
  /**
   * Posts an order payment journal to the STORE wallet:
   * - CREDIT PAYMENT for amountPaid
   * - DEBIT FEE for gatewayFee (if any)
   */
  static async postStoreOrderPayment(params: {
    session: mongoose.ClientSession;
    transactionId: string;
    currency: string;
    amountPaid: number;
    gatewayFee?: number;
    actor: ILedgerActorRef;
    source: string;
    traceId: string;
  }): Promise<void> {
    const {
      session,
      transactionId,
      currency,
      amountPaid,
      gatewayFee = 0,
      actor,
      source,
      traceId,
    } = params;

    if (!Number.isInteger(amountPaid) || amountPaid < 1) {
      throw ValidationError("amountPaid must be a positive integer (kobo).");
    }
    if (!Number.isInteger(gatewayFee) || gatewayFee < 0) {
      throw ValidationError(
        "gatewayFee must be a non-negative integer (kobo)."
      );
    }
    if (gatewayFee > amountPaid) {
      throw ValidationError("gatewayFee cannot exceed amountPaid.");
    }

    const tx = await Transaction.findById(transactionId).session(session);
    if (!tx) throw ValidationError("Transaction not found for ledger posting.");
    if (tx.postedAt) return;

    const storeWallet = await WalletService.getStoreWallet(currency, session);

    const lines: LedgerLine[] = [
      {
        walletId: storeWallet._id,
        currency,
        bucket: "AVAILABLE",
        direction: "CREDIT",
        amount: amountPaid,
        entryType: "PAYMENT",
        narration: "Order payment received",
        dedupeKey: `tx:${transactionId}:payment`,
      },
    ];
    if (gatewayFee > 0) {
      lines.push({
        walletId: storeWallet._id,
        currency,
        bucket: "AVAILABLE",
        direction: "DEBIT",
        amount: gatewayFee,
        entryType: "FEE",
        narration: "Payment gateway fee",
        dedupeKey: `tx:${transactionId}:fee`,
      });
    }

    for (const line of lines) {
      const wallet = await Wallet.findById(line.walletId).session(session);
      if (!wallet) throw ValidationError("Wallet not found.");
      if (wallet.status === "FROZEN") {
        throw ValidationError("Wallet is frozen.");
      }
      if (wallet.currency !== line.currency) {
        throw ValidationError("Wallet currency mismatch.");
      }

      const delta = deltaFor(line.direction, line.amount);
      if (line.bucket === "AVAILABLE") {
        const next = wallet.available + delta;
        if (next < 0) throw ValidationError("Insufficient available balance.");
        wallet.available = next;
      } else {
        const next = wallet.pending + delta;
        if (next < 0) throw ValidationError("Insufficient pending balance.");
        wallet.pending = next;
      }

      await wallet.save({ session });

      const entry: ILedgerEntryAttrs = {
        transactionId: new mongoose.Types.ObjectId(transactionId),
        walletId: wallet._id,
        currency: line.currency,
        bucket: line.bucket,
        direction: line.direction,
        amount: line.amount,
        entryType: line.entryType,
        narration: line.narration,
        actor,
        source,
        traceId,
        dedupeKey: line.dedupeKey,
        balanceAfterAvailable: wallet.available,
        balanceAfterPending: wallet.pending,
      };

      await LedgerEntry.create([entry], { session });
    }

    tx.postedAt = new Date();
    tx.gatewayFee = gatewayFee;
    await tx.save({ session });

    /* ── Outbox events (inside session for atomicity) ── */

    await OutboxService.enqueue(
      {
        type: "TRANSACTION_POSTED",
        dedupeKey: `tx:${transactionId}:posted`,
        payload: {
          transactionId,
          currency,
          amountPaid,
          gatewayFee,
          netAmount: amountPaid - gatewayFee,
          postedAt: tx.postedAt.toISOString(),
        },
      },
      session
    );

    const freshWallet = await Wallet.findById(storeWallet._id)
      .session(session)
      .lean();
    if (freshWallet) {
      await OutboxService.enqueue(
        {
          type: "WALLET_UPDATED",
          dedupeKey: `tx:${transactionId}:wallet:${storeWallet._id.toString()}`,
          payload: {
            walletId: storeWallet._id.toString(),
            currency,
            available: freshWallet.available,
            pending: freshWallet.pending,
            triggerTransactionId: transactionId,
          },
        },
        session
      );
    }
  }

  /**
   * Posts a full reversal of a previously posted transaction.
   * Creates opposite-direction ledger entries, updates wallet balances,
   * creates a new REVERSAL Transaction, and emits outbox events.
   */
  static async postReversalJournal(params: {
    session: mongoose.ClientSession;
    originalTransactionId: string;
    reason: string;
    actor: ILedgerActorRef;
    source: string;
    traceId: string;
  }): Promise<{ reversalTransactionId: string }> {
    const { session, originalTransactionId, reason, actor, source, traceId } =
      params;

    /* Validate original transaction */
    const originalTx = await Transaction.findById(
      originalTransactionId
    ).session(session);
    if (!originalTx) {
      throw ValidationError("Original transaction not found.");
    }
    if (!originalTx.postedAt) {
      throw ValidationError(
        "Cannot reverse a transaction that has not been posted."
      );
    }
    if (
      originalTx.status === "REFUNDED" ||
      originalTx.status === "REFUND_INITIATED"
    ) {
      throw ValidationError("Transaction has already been refunded/reversed.");
    }

    /* Fetch original ledger entries */
    const originalEntries = await LedgerEntry.find({
      transactionId: originalTx._id,
    })
      .session(session)
      .lean();
    if (originalEntries.length === 0) {
      throw ValidationError(
        "No ledger entries found for the original transaction."
      );
    }

    /* Create the REVERSAL transaction */
    const [reversalTx] = await Transaction.create(
      [
        {
          type: "REVERSAL" as const,
          order: originalTx.order,
          user: originalTx.user,
          amount: originalTx.amount,
          currency: originalTx.currency,
          status: "SUCCESS" as const,
          paymentMethod: originalTx.paymentMethod,
          provider: originalTx.provider,
          providerRef: originalTx.providerRef,
          idempotencyKey: `reversal:${originalTransactionId}`,
          postedAt: new Date(),
          paidAt: new Date(),
          metadata: {
            originalTransactionId,
            reason,
          },
        },
      ],
      { session }
    );
    if (!reversalTx) {
      throw ValidationError("Failed to create reversal transaction.");
    }

    /* Post opposite-direction entries */
    for (const entry of originalEntries) {
      const oppositeDirection =
        entry.direction === "CREDIT" ? "DEBIT" : "CREDIT";

      const wallet = await Wallet.findById(entry.walletId).session(session);
      if (!wallet) throw ValidationError("Wallet not found for reversal.");

      const delta = deltaFor(
        oppositeDirection as LedgerDirection,
        entry.amount
      );
      if (entry.bucket === "AVAILABLE") {
        const next = wallet.available + delta;
        if (next < 0) {
          throw ValidationError("Insufficient available balance for reversal.");
        }
        wallet.available = next;
      } else {
        const next = wallet.pending + delta;
        if (next < 0) {
          throw ValidationError("Insufficient pending balance for reversal.");
        }
        wallet.pending = next;
      }

      await wallet.save({ session });

      const reversalEntry: ILedgerEntryAttrs = {
        transactionId: reversalTx._id,
        walletId: wallet._id,
        currency: entry.currency,
        bucket: entry.bucket as LedgerBucket,
        direction: oppositeDirection as LedgerDirection,
        amount: entry.amount,
        entryType: "REVERSAL",
        narration: `Reversal: ${entry.narration ?? entry.entryType}`,
        actor,
        source,
        traceId,
        dedupeKey: `reversal:${originalTransactionId}:${entry._id.toString()}`,
        balanceAfterAvailable: wallet.available,
        balanceAfterPending: wallet.pending,
      };

      await LedgerEntry.create([reversalEntry], { session });
    }

    /* Mark original transaction as refunded */
    originalTx.status = "REFUNDED";
    originalTx.refundedAt = new Date();
    await originalTx.save({ session });

    /* Outbox events */
    await OutboxService.enqueue(
      {
        type: "TRANSACTION_POSTED",
        dedupeKey: `tx:${reversalTx._id.toString()}:posted`,
        payload: {
          transactionId: reversalTx._id.toString(),
          type: "REVERSAL",
          originalTransactionId,
          currency: reversalTx.currency,
          amount: reversalTx.amount,
          postedAt: reversalTx.postedAt!.toISOString(),
        },
      },
      session
    );

    const storeWallet = await WalletService.getStoreWallet(
      originalTx.currency,
      session
    );
    const freshWallet = await Wallet.findById(storeWallet._id)
      .session(session)
      .lean();
    if (freshWallet) {
      await OutboxService.enqueue(
        {
          type: "WALLET_UPDATED",
          dedupeKey: `tx:${reversalTx._id.toString()}:wallet:${storeWallet._id.toString()}`,
          payload: {
            walletId: storeWallet._id.toString(),
            currency: freshWallet.currency,
            available: freshWallet.available,
            pending: freshWallet.pending,
            triggerTransactionId: reversalTx._id.toString(),
          },
        },
        session
      );
    }

    return { reversalTransactionId: reversalTx._id.toString() };
  }

  /**
   * Posts a manual wallet adjustment (credit or debit).
   * Creates an ADJUSTMENT transaction and a single ledger entry.
   */
  static async postAdjustmentJournal(params: {
    session: mongoose.ClientSession;
    walletId: string;
    direction: "CREDIT" | "DEBIT";
    amount: number;
    currency: string;
    reason: string;
    actor: ILedgerActorRef;
    source: string;
    traceId: string;
  }): Promise<{ adjustmentTransactionId: string }> {
    const {
      session,
      walletId,
      direction,
      amount,
      currency,
      reason,
      actor,
      source,
      traceId,
    } = params;

    if (!Number.isInteger(amount) || amount < 1) {
      throw ValidationError("Amount must be a positive integer (kobo).");
    }

    const wallet = await Wallet.findById(walletId).session(session);
    if (!wallet) throw ValidationError("Wallet not found.");
    if (wallet.status === "FROZEN") {
      throw ValidationError("Wallet is frozen.");
    }
    if (wallet.currency !== currency.toUpperCase()) {
      throw ValidationError("Currency mismatch.");
    }

    /* Create ADJUSTMENT transaction (uses wallet owner as a reference) */
    const idempotencyKey = `adjust:${walletId}:${Date.now()}:${traceId}`;
    const [adjustTx] = await Transaction.create(
      [
        {
          type: "ADJUSTMENT" as const,
          order: wallet._id, // self-reference for non-order transactions
          amount,
          currency: wallet.currency,
          status: "SUCCESS" as const,
          paymentMethod: "WALLET" as const,
          provider: "internal",
          idempotencyKey,
          postedAt: new Date(),
          paidAt: new Date(),
          metadata: { reason, direction, walletId },
        },
      ],
      { session }
    );
    if (!adjustTx)
      throw ValidationError("Failed to create adjustment transaction.");

    /* Update wallet balance */
    const delta = deltaFor(direction, amount);
    const next = wallet.available + delta;
    if (next < 0) {
      throw ValidationError(
        "Insufficient available balance for debit adjustment."
      );
    }
    wallet.available = next;
    await wallet.save({ session });

    /* Post ledger entry */
    const entry: ILedgerEntryAttrs = {
      transactionId: adjustTx._id,
      walletId: wallet._id,
      currency: wallet.currency,
      bucket: "AVAILABLE",
      direction,
      amount,
      entryType: "ADJUSTMENT",
      narration: `Admin adjustment: ${reason}`,
      actor,
      source,
      traceId,
      dedupeKey: `adjust:${adjustTx._id.toString()}`,
      balanceAfterAvailable: wallet.available,
      balanceAfterPending: wallet.pending,
    };
    await LedgerEntry.create([entry], { session });

    /* Outbox events */
    await OutboxService.enqueue(
      {
        type: "TRANSACTION_POSTED",
        dedupeKey: `tx:${adjustTx._id.toString()}:posted`,
        payload: {
          transactionId: adjustTx._id.toString(),
          type: "ADJUSTMENT",
          direction,
          amount,
          currency: wallet.currency,
          postedAt: adjustTx.postedAt!.toISOString(),
        },
      },
      session
    );

    await OutboxService.enqueue(
      {
        type: "WALLET_UPDATED",
        dedupeKey: `tx:${adjustTx._id.toString()}:wallet:${walletId}`,
        payload: {
          walletId,
          currency: wallet.currency,
          available: wallet.available,
          pending: wallet.pending,
          triggerTransactionId: adjustTx._id.toString(),
        },
      },
      session
    );

    return { adjustmentTransactionId: adjustTx._id.toString() };
  }
}
