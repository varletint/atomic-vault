import mongoose from "mongoose";
import {
  Settlement,
  type ISettlement,
  type ISettlementItem,
  type SettlementStatus,
  Transaction,
  type ITransaction,
} from "../models/index.js";
import {
  PaystackSettlementClient,
  type SettlementListResult,
  type SettlementTransactionResult,
} from "../payments/paystack-settlement.js";
import { LedgerService } from "./LedgerService.js";
import { OutboxService } from "./OutboxService.js";
import { OutboxProcessor } from "./OutboxProcessor.js";
import { logger } from "../utils/logger.js";

export class SettlementService {
  /**
   * Process a single Paystack settlement batch.
   * Idempotent — skips if already RECONCILED.
   */
  static async processSettlement(
    settlement: SettlementListResult,
    transactions: SettlementTransactionResult[]
  ): Promise<ISettlement> {
    const existing = await Settlement.findOne({
      paystackId: String(settlement.id),
    }).lean<ISettlement>();

    if (existing && existing.status === "RECONCILED") {
      logger.info(
        `[Settlement] Already reconciled: ${settlement.id}, skipping`
      );
      return existing;
    }

    // Match each settlement item to an internal transaction
    const items: ISettlementItem[] = [];
    let unmatchedCount = 0;
    let mismatchCount = 0;

    for (const txn of transactions) {
      const internalTx = await Transaction.findOne({
        providerRef: txn.reference,
        status: "CONFIRMED",
      }).lean<ITransaction>();

      let matchStatus: ISettlementItem["matchStatus"];
      let transactionId: mongoose.Types.ObjectId | undefined;

      if (!internalTx) {
        matchStatus = "UNMATCHED";
        unmatchedCount++;
        logger.warn(`[Settlement] Unmatched transaction: ${txn.reference}`);
      } else if (internalTx.amount !== txn.grossAmount) {
        matchStatus = "AMOUNT_MISMATCH";
        mismatchCount++;
        transactionId = internalTx._id;
        logger.warn(
          `[Settlement] Amount mismatch for ${txn.reference}: ` +
            `internal=${internalTx.amount} vs paystack=${txn.grossAmount}`
        );
      } else {
        matchStatus = "MATCHED";
        transactionId = internalTx._id;
      }

      items.push({
        paystackRef: txn.reference,
        grossAmount: txn.grossAmount,
        fee: txn.fee,
        netAmount: txn.netAmount,
        matchStatus,
        transactionId,
      });
    }

    // Determine overall status
    let status: SettlementStatus;
    if (unmatchedCount === 0 && mismatchCount === 0) {
      status = "RECONCILED";
    } else if (unmatchedCount === items.length) {
      status = "FAILED";
    } else {
      status = "PARTIAL";
    }

    // Upsert the settlement record (idempotent via paystackId)
    const doc = await Settlement.findOneAndUpdate(
      { paystackId: String(settlement.id) },
      {
        $set: {
          status,
          totalAmount: settlement.totalAmount,
          totalFees: settlement.totalFees,
          netAmount: settlement.netAmount,
          currency: settlement.currency,
          settledAt: new Date(settlement.settledAt),
          reconciledAt: status === "RECONCILED" ? new Date() : undefined,
          items,
          unmatchedCount,
          mismatchCount,
        },
      },
      { upsert: true, returnDocument: "after" }
    ).lean<ISettlement>();

    if (!doc) throw new Error("Failed to upsert settlement document.");

    logger.info(`[Settlement] Processed settlement ${settlement.id}`, {
      status,
      totalItems: items.length,
      matched: items.length - unmatchedCount - mismatchCount,
      unmatched: unmatchedCount,
      mismatched: mismatchCount,
    });

    // Post ledger entries + outbox event inside a transaction
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // Debit the wallet for auto-settled funds (only for matched items)
        if (settlement.netAmount > 0 && status !== "FAILED") {
          await LedgerService.postSettlementDebit({
            session,
            settlementId: doc._id.toString(),
            netAmount: settlement.netAmount,
            currency: settlement.currency,
            actor: { type: "SYSTEM" },
            source: "settlement:reconcile",
            traceId: `settlement:${settlement.id}`,
          });
        }

        await OutboxService.enqueue(
          {
            type: "SETTLEMENT_RECONCILED",
            dedupeKey: `settlement:${settlement.id}`,
            payload: {
              settlementId: doc._id.toString(),
              paystackId: String(settlement.id),
              status,
              totalAmount: settlement.totalAmount,
              netAmount: settlement.netAmount,
              matched: items.length - unmatchedCount - mismatchCount,
              unmatched: unmatchedCount,
              mismatched: mismatchCount,
            },
          },
          session
        );
      });
    } finally {
      await session.endSession();
    }

    OutboxProcessor.scheduleDrain();

    return doc;
  }

  /**
   * Polling entry point — fetches recent settlements from Paystack and reconciles.
   */
  static async syncFromPaystack(lookbackHours = 48): Promise<{
    processed: number;
    reconciled: number;
    partial: number;
    failed: number;
  }> {
    const from = new Date(Date.now() - lookbackHours * 60 * 60_000)
      .toISOString()
      .split("T")[0]; // YYYY-MM-DD

    logger.info(`[Settlement] Syncing settlements from ${from}`);

    const settlements = await PaystackSettlementClient.fetchSettlements({
      from,
    });

    let processed = 0;
    let reconciled = 0;
    let partial = 0;
    let failed = 0;

    for (const settlement of settlements) {
      try {
        const transactions =
          await PaystackSettlementClient.fetchSettlementTransactions(
            settlement.id
          );

        const result = await this.processSettlement(settlement, transactions);
        processed++;

        switch (result.status) {
          case "RECONCILED":
            reconciled++;
            break;
          case "PARTIAL":
            partial++;
            break;
          case "FAILED":
            failed++;
            break;
        }
      } catch (err) {
        logger.error(
          `[Settlement] Failed to process settlement ${settlement.id}`,
          { error: String(err) }
        );
        failed++;
      }
    }

    logger.info("[Settlement] Sync complete", {
      processed,
      reconciled,
      partial,
      failed,
    });

    return { processed, reconciled, partial, failed };
  }
}
