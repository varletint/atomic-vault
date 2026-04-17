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

/* Types */

export type ReconciliationReport = {
  walletId: string;
  currency: string;
  snapshotAt: Date;
  wallet: { available: number; pending: number };
  ledger: { available: number; pending: number };
  drift: { available: number; pending: number };
  isBalanced: boolean;
  unpostedTransactions: number;
  entries: { total: number; debits: number; credits: number };
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

/* Service */

export class ReconciliationService {
  /**
   * Read-only wallet reconciliation.
   * Compares on-record wallet balances against the computed sum
   * of all ledger entries for that wallet.
   */
  static async reconcileWallet(
    walletId: string
  ): Promise<ReconciliationReport> {
    const wallet = await Wallet.findById(walletId).lean();
    if (!wallet) throw NotFoundError("Wallet");

    /* Aggregate ledger entries by (bucket, direction) */
    const agg = await LedgerEntry.aggregate<{
      _id: { bucket: string; direction: string };
      total: number;
      count: number;
    }>([
      { $match: { walletId: wallet._id } },
      {
        $group: {
          _id: { bucket: "$bucket", direction: "$direction" },
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    let ledgerAvailable = 0;
    let ledgerPending = 0;
    let totalDebits = 0;
    let totalCredits = 0;
    let totalEntries = 0;

    for (const row of agg) {
      const signed = row._id.direction === "CREDIT" ? row.total : -row.total;
      if (row._id.bucket === "AVAILABLE") ledgerAvailable += signed;
      else ledgerPending += signed;

      if (row._id.direction === "DEBIT") totalDebits += row.count;
      else totalCredits += row.count;
      totalEntries += row.count;
    }

    const driftAvailable = wallet.available - ledgerAvailable;
    const driftPending = wallet.pending - ledgerPending;

    const unposted = await Transaction.countDocuments({
      status: "SUCCESS",
      postedAt: { $exists: false },
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
        debits: totalDebits,
        credits: totalCredits,
      },
    };
  }

  /** Find SUCCESS transactions that were never posted to the ledger. */
  static async findUnpostedTransactions(): Promise<ITransaction[]> {
    return Transaction.find({
      status: "SUCCESS",
      postedAt: { $exists: false },
    })
      .sort({ createdAt: 1 })
      .lean<ITransaction[]>();
  }

  /**
   * Auto-repair: post missing ledger entries for unposted SUCCESS
   * transactions. Each repair runs in its own session so a single
   * failure does not block the rest.
   */
  static async repairUnposted(params: {
    actor: ILedgerActorRef;
    source: string;
    dryRun?: boolean;
  }): Promise<RepairReport> {
    const { actor, source, dryRun = false } = params;
    const unposted = await ReconciliationService.findUnpostedTransactions();

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
        const gatewayFee =
          typeof tx.gatewayFee === "number" ? tx.gatewayFee : 0;

        await LedgerService.postStoreOrderPayment({
          session,
          transactionId: tx._id.toString(),
          currency: tx.currency,
          amountPaid: tx.amount,
          gatewayFee,
          actor,
          source,
          traceId: `repair:${tx._id.toString()}`,
        });

        await session.commitTransaction();
        results.push({ ...base, status: "repaired" });
        repaired++;
      } catch (err) {
        await session.abortTransaction();
        const message = err instanceof Error ? err.message : "Unknown error";

        /* Already posted (postedAt guard) → skip, not error */
        if (message.includes("Transaction not found")) {
          results.push({ ...base, status: "skipped", reason: message });
          skipped++;
        } else {
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
