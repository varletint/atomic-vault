import { Transaction } from "../models/index.js";
import { PaystackTransferClient } from "../payments/paystack-transfer.js";
import { WithdrawalService } from "../services/WithdrawalService.js";
import { AuditLog } from "../models/index.js";
import { logger } from "../utils/logger.js";

const STALE_THRESHOLD_MS = 10 * 60_000; // 10 minutes

export async function reconcileTransfers(): Promise<{
  total: number;
  confirmed: number;
  failed: number;
  pending: number;
  errors: number;
}> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

  const staleTxs = await Transaction.find({
    type: "PAYOUT",
    status: { $in: ["PROCESSING", "UNKNOWN"] },
    updatedAt: { $lte: cutoff },
  })
    .limit(50)
    .lean();

  let confirmed = 0;
  let failed = 0;
  let pending = 0;
  let errors = 0;

  for (const tx of staleTxs) {
    try {
      const result = await PaystackTransferClient.verifyTransfer(
        tx.idempotencyKey
      );

      if (result.status === "success") {
        await WithdrawalService.confirmWithdrawal(tx.idempotencyKey);
        confirmed++;
        logger.info(
          `[Reconciliation] Confirmed stale transfer ${tx._id.toString()}`
        );
      } else if (
        result.status === "failed" ||
        result.status === "reversed" ||
        result.status === "abandoned"
      ) {
        await WithdrawalService.failWithdrawal(
          tx.idempotencyKey,
          `Reconciliation: transfer ${result.status}`
        );
        failed++;
        logger.info(
          `[Reconciliation] Failed stale transfer ${tx._id.toString()} — ${
            result.status
          }`
        );
      } else {
        pending++;
      }
    } catch (err) {
      errors++;
      logger.error(
        `[Reconciliation] Error resolving transfer ${tx._id.toString()}`,
        { error: String(err) }
      );
    }
  }

  const summary = {
    total: staleTxs.length,
    confirmed,
    failed,
    pending,
    errors,
  };

  if (staleTxs.length > 0) {
    await AuditLog.create({
      action: "TRANSFER_RECONCILIATION",
      actor: { isSystem: true, role: "SYSTEM" },
      entity: { type: "Other", id: "reconcileTransfers", name: "Worker" },
      metadata: summary,
      severity: errors > 0 ? "warning" : "info",
    });
  }

  return summary;
}
