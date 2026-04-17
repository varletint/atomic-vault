import mongoose from "mongoose";
import {
  LedgerEntry,
  Wallet,
  type IWallet,
  type ILedgerEntryAttrs,
  type LedgerBucket,
  type LedgerDirection,
  type LedgerEntryType,
  type ILedgerActorRef,
  Transaction,
} from "../models/index.js";
import { ValidationError } from "../utils/AppError.js";

const STORE_OWNER_ID = new mongoose.Types.ObjectId("000000000000000000000001");

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

function deltaFor(
  direction: LedgerDirection,
  amount: number
): number {
  return direction === "CREDIT" ? amount : -amount;
}

async function getOrCreateStoreWallet(params: {
  session: mongoose.ClientSession;
  currency: string;
}): Promise<IWallet> {
  const { session, currency } = params;
  const existing = await Wallet.findOne({
    ownerType: "STORE",
    ownerId: STORE_OWNER_ID,
    currency,
  }).session(session);
  if (existing) return existing;

  const [created] = await Wallet.create(
    [
      {
        ownerType: "STORE" as const,
        ownerId: STORE_OWNER_ID,
        currency,
        available: 0,
        pending: 0,
        status: "ACTIVE" as const,
      },
    ],
    { session }
  );
  if (!created) throw new Error("Failed to create store wallet");
  return created;
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
      throw ValidationError("gatewayFee must be a non-negative integer (kobo).");
    }
    if (gatewayFee > amountPaid) {
      throw ValidationError("gatewayFee cannot exceed amountPaid.");
    }

    const tx = await Transaction.findById(transactionId).session(session);
    if (!tx) throw ValidationError("Transaction not found for ledger posting.");
    if (tx.postedAt) return; 

    const storeWallet = await getOrCreateStoreWallet({ session, currency });

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
  }
}

