import mongoose from "mongoose";
import { Order, type OrderStatus } from "../models/index.js";
import { InventoryService } from "./InventoryService.js";
import { logger } from "../utils/logger.js";

function reservationTtlMs(): number {
  const n = Number(process.env.RESERVATION_TTL_MS);
  return Number.isFinite(n) && n > 0 ? n : 15 * 60_000;
}

/**
 * Statuses where inventory is RESERVED and needs reaping if stale.
 * PENDING        → never reached the gateway   → CANCELLED (release)
 * PAYMENT_PROCESSING → gateway timeout / abandon → PAYMENT_FAILED (release)
 * PAYMENT_FAILED → customer never retried       → CANCELLED (release)
 */
const REAPABLE_STATUSES: OrderStatus[] = [
  "PENDING",
  "PAYMENT_PROCESSING",
  "PAYMENT_FAILED",
];

export type RunReservationReaperOptions = {
  quiet?: boolean;
};

export class ReservationReaperService {
  private static lastRequestKickoff = 0;

  static kickFromRequest(): void {
    if (process.env.DISABLE_RESERVATION_REAPER === "true") return;

    const raw = Number(process.env.RESERVATION_REAPER_THROTTLE_MS);
    const throttleMs = Number.isFinite(raw) && raw > 0 ? raw : 60_000;

    const now = Date.now();
    if (now - this.lastRequestKickoff < throttleMs) return;
    this.lastRequestKickoff = now;

    void this.runOnce({ quiet: true }).catch((err) =>
      logger.error("Reaper background run failed", { error: String(err) })
    );
  }

  static async runOnce(
    opts: RunReservationReaperOptions = {}
  ): Promise<{ scanned: number; released: number; failed: number }> {
    const ttlMs = reservationTtlMs();
    const cutoff = new Date(Date.now() - ttlMs);

    const staleOrders = await Order.find({
      status: { $in: REAPABLE_STATUSES },
      createdAt: { $lte: cutoff },
    }).lean();

    if (staleOrders.length === 0) {
      if (!opts.quiet) {
        logger.info("No stale reservations found");
      }
      return { scanned: 0, released: 0, failed: 0 };
    }

    if (!opts.quiet) {
      logger.info("Stale orders with reserved inventory found", {
        count: staleOrders.length,
      });
    }

    let released = 0;
    let failed = 0;

    for (const order of staleOrders) {
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const liveOrder = await Order.findById(order._id).session(session);
        if (
          !liveOrder ||
          !REAPABLE_STATUSES.includes(liveOrder.status as OrderStatus)
        ) {
          await session.abortTransaction();
          continue;
        }

        for (const item of liveOrder.items) {
          await InventoryService.releaseReservation(
            item.product.toString(),
            item.quantity,
            session
          );
        }

        // PAYMENT_PROCESSING → PAYMENT_FAILED (recoverable, but TTL expired)
        // PENDING / PAYMENT_FAILED → CANCELLED (terminal for this order)
        const nextStatus: OrderStatus =
          liveOrder.status === "PAYMENT_PROCESSING"
            ? "PAYMENT_FAILED"
            : "CANCELLED";

        liveOrder.status = nextStatus;
        liveOrder.statusHistory.push({
          status: nextStatus,
          timestamp: new Date(),
          note: `Reservation expired (${liveOrder.status} > ${Math.round(
            ttlMs / 60_000
          )}min) — auto-released by reaper`,
        });

        await liveOrder.save({ session });
        await session.commitTransaction();
        released++;
      } catch (err) {
        await session.abortTransaction();
        logger.error("Failed to release stale order", {
          orderId: order._id.toString(),
          error: err instanceof Error ? err.message : String(err),
        });
        failed++;
      } finally {
        session.endSession();
      }
    }

    if (!opts.quiet) {
      logger.info("Reaper run complete", {
        released,
        failed,
        total: staleOrders.length,
      });
    }

    return { scanned: staleOrders.length, released, failed };
  }
}
