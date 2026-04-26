import mongoose from "mongoose";
import {
  Wallet,
  LedgerEntry,
  Transaction,
  type ITransaction,
  type ILedgerActorRef,
} from "../models/index.js";
import { NotFoundError, ValidationError } from "../utils/AppError.js";
import { LedgerService } from "./LedgerService.js";

export type ReconciliationReport = {
  walletId: string;
  currency: string;
  snapshotAt: Date;
  wallet: { available: number; pending: number };
  ledger: { available: number; pending: number };
  drift: { available: number; pending: number };
  isBalanced: boolean;
  unpostedTransactions: number;
  entries: {
    total: number;
    debitCount: number;
    creditCount: number;
    debitSum: number;
    creditSum: number;
  };
};

export type RepairResult = {
  transactionId: string;
  reference: string;
  amount: number;
  currency: string;
  status: "repaired" | "skipped" | "error";
  reason?: string;
};

export type RepairReport = {
  dryRun: boolean;
  actor: ILedgerActorRef;
  source: string;
  repairedAt: Date;
  results: RepairResult[];
  summary: { total: number; repaired: number; skipped: number; errors: number };
};

export class ReconciliationService {
  static async reconcileWallet(
    walletId: string
  ): Promise<ReconciliationReport> {
    const wallet = await Wallet.findById(walletId).lean();
    if (!wallet) throw NotFoundError("Wallet");

    const agg = await LedgerEntry.aggregate<{
      _id: { account: string; direction: string };
      total: number;
      count: number;
    }>([
      { $match: { walletId: wallet._id } },
      {
        $group: {
          _id: { account: "$account", direction: "$direction" },
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    let ledgerAvailable = 0;
    let ledgerPending = 0;
    let totalDebits = 0;
    let totalCredits = 0;
    let debitSum = 0;
    let creditSum = 0;
    let totalEntries = 0;

    for (const row of agg) {
      const signed = row._id.direction === "CREDIT" ? row.total : -row.total;
      if (row._id.account === "WALLET_AVAILABLE") ledgerAvailable += signed;
      else if (row._id.account === "WALLET_PENDING") ledgerPending += signed;

      if (row._id.direction === "DEBIT") {
        totalDebits += row.count;
        debitSum += row.total;
      } else {
        totalCredits += row.count;
        creditSum += row.total;
      }
      totalEntries += row.count;
    }

    const driftAvailable = wallet.available - ledgerAvailable;
    const driftPending = wallet.pending - ledgerPending;

    const postedTxIds = await LedgerEntry.distinct("transactionId", {
      walletId: wallet._id,
    });
    const unposted = await Transaction.countDocuments({
      status: "CONFIRMED",
      postedAt: { $exists: false },
      _id: { $nin: postedTxIds },
    });

    return {
      walletId: wallet._id.toString(),
      currency: wallet.currency,
      snapshotAt: new Date(),
      wallet: { available: wallet.available, pending: wallet.pending },
      ledger: { available: ledgerAvailable, pending: ledgerPending },
      drift: { available: driftAvailable, pending: driftPending },
      isBalanced: driftAvailable === 0 && driftPending === 0,
      unpostedTransactions: unposted,
      entries: {
        total: totalEntries,
        debitCount: totalDebits,
        creditCount: totalCredits,
        debitSum,
        creditSum,
      },
    };
  }

  static async findUnpostedTransactions(
    walletId: string
  ): Promise<ITransaction[]> {
    const wallet = await Wallet.findById(walletId).lean();
    if (!wallet) throw NotFoundError("Wallet");

    const postedTxIds = await LedgerEntry.distinct("transactionId", {
      walletId: wallet._id,
    });

    return Transaction.find({
      status: "CONFIRMED",
      postedAt: { $exists: false },
      _id: { $nin: postedTxIds },
    })
      .sort({ createdAt: 1 })
      .lean<ITransaction[]>();
  }

  static async repairUnposted(params: {
    walletId: string;
    actor: ILedgerActorRef;
    source: string;
    dryRun?: boolean;
  }): Promise<RepairReport> {
    const { walletId, actor, source, dryRun = false } = params;
    const unposted = await ReconciliationService.findUnpostedTransactions(
      walletId
    );

    const results: RepairResult[] = [];
    let repaired = 0;
    let skipped = 0;
    let errors = 0;

    for (const tx of unposted) {
      const base: Pick<
        RepairResult,
        "transactionId" | "reference" | "amount" | "currency"
      > = {
        transactionId: tx._id.toString(),
        reference: tx.idempotencyKey,
        amount: tx.amount,
        currency: tx.currency,
      };

      if (dryRun) {
        results.push({ ...base, status: "skipped", reason: "dry_run" });
        skipped++;
        continue;
      }

      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        const freshTx = await Transaction.findById(tx._id).session(session);
        if (!freshTx || freshTx.postedAt) {
          await session.abortTransaction();
          results.push({
            ...base,
            status: "skipped",
            reason: freshTx ? "already_posted" : "transaction_not_found",
          });
          skipped++;
          continue;
        }

        const gatewayFee =
          typeof freshTx.gatewayFee === "number" ? freshTx.gatewayFee : 0;

        await LedgerService.postStoreOrderPayment({
          session,
          transactionId: freshTx._id.toString(),
          currency: freshTx.currency,
          amountPaid: freshTx.amount,
          gatewayFee,
          actor,
          source,
          traceId: `repair:${freshTx._id.toString()}`,
        });

        await session.commitTransaction();
        results.push({ ...base, status: "repaired" });
        repaired++;
      } catch (err: unknown) {
        await session.abortTransaction();

        const code = (err as { code?: number }).code;
        if (code === 11000) {
          results.push({
            ...base,
            status: "skipped",
            reason: "duplicate_ledger_entry",
          });
          skipped++;
        } else {
          const message = err instanceof Error ? err.message : "Unknown error";
          results.push({ ...base, status: "error", reason: message });
          errors++;
        }
      } finally {
        session.endSession();
      }
    }

    return {
      dryRun,
      actor,
      source,
      repairedAt: new Date(),
      results,
      summary: {
        total: unposted.length,
        repaired,
        skipped,
        errors,
      },
    };
  }
}
