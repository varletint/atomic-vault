import crypto from "node:crypto";
import { OutboxEvent, type IOutboxEvent } from "../models/index.js";
import { OrderNotificationService } from "./OrderNotificationService.js";
import { logger } from "../utils/logger.js";

type ProcessOptions = {
  batchSize?: number;
  lockTtlMs?: number;
};

function backoffMs(attempts: number): number {
  // 1m, 5m, 15m, 1h, 6h
  const schedule = [60_000, 300_000, 900_000, 3_600_000, 21_600_000];
  return schedule[Math.min(attempts, schedule.length - 1)]!;
}

export class OutboxProcessor {
  static scheduleDrain(): void {
    void this.drainOnce().catch((err) =>
      logger.error("Instant outbox drain failed", { error: String(err) })
    );
  }

  static async drainOnce(opts: ProcessOptions = {}): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
  }> {
    const batchSize = opts.batchSize ?? 20;
    const lockTtlMs = opts.lockTtlMs ?? 10 * 60_000;

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < batchSize; i++) {
      const event = await this.claimNext(lockTtlMs);
      if (!event) break;

      processed++;
      try {
        await this.handle(event);
        succeeded++;
        if (!event.lockId) throw new Error("Outbox lockId missing on success.");
        await OutboxEvent.updateOne(
          { _id: event._id, lockId: event.lockId },
          { $set: { status: "DONE" }, $unset: { lockedAt: 1, lockId: 1 } }
        );
      } catch (err) {
        failed++;
        if (!event.lockId) throw new Error("Outbox lockId missing on failure.");
        const attempts = (event.attempts ?? 0) + 1;
        const nextRunAt = new Date(Date.now() + backoffMs(attempts));
        await OutboxEvent.updateOne(
          { _id: event._id, lockId: event.lockId },
          {
            $set: {
              status: attempts >= 5 ? "FAILED" : "PENDING",
              nextRunAt,
              lastError: err instanceof Error ? err.message : String(err),
            },
            $unset: { lockedAt: 1, lockId: 1 },
            $inc: { attempts: 1 },
          }
        );
      }
    }

    return { processed, succeeded, failed };
  }

  private static async claimNext(
    lockTtlMs: number
  ): Promise<IOutboxEvent | null> {
    const now = new Date();
    const lockExpiry = new Date(Date.now() - lockTtlMs);
    const lockId = crypto.randomUUID();

    return await OutboxEvent.findOneAndUpdate(
      {
        status: "PENDING",
        nextRunAt: { $lte: now },
        $or: [
          { lockedAt: { $exists: false } },
          { lockedAt: { $lte: lockExpiry } },
        ],
      },
      {
        $set: {
          status: "PROCESSING",
          lockedAt: now,
          lockId,
        },
      },
      { sort: { nextRunAt: 1, createdAt: 1 }, new: true }
    ).lean<IOutboxEvent | null>();
  }

  private static async handle(event: IOutboxEvent): Promise<void> {
    const payload = event.payload as {
      orderId?: string;
      paymentReference?: string;
      note?: string;
      reason?: string;
    };

    if (event.type === "ORDER_CONFIRMED") {
      if (!payload.orderId) {
        throw new Error("ORDER_CONFIRMED outbox payload missing orderId.");
      }
      await OrderNotificationService.handleOrderConfirmed({
        orderId: payload.orderId,
        paymentReference: payload.paymentReference,
      });
      return;
    }

    if (event.type === "ORDER_DELIVERED") {
      if (!payload.orderId) {
        throw new Error("ORDER_DELIVERED outbox payload missing orderId.");
      }
      await OrderNotificationService.handleOrderDelivered({
        orderId: payload.orderId,
      });
      return;
    }

    if (event.type === "ORDER_SHIPPED") {
      if (!payload.orderId) {
        throw new Error("ORDER_SHIPPED outbox payload missing orderId.");
      }
      await OrderNotificationService.handleOrderShipped({
        orderId: payload.orderId,
        note: payload.note,
      });
      return;
    }

    if (event.type === "ORDER_CANCELLED") {
      if (!payload.orderId) {
        throw new Error("ORDER_CANCELLED outbox payload missing orderId.");
      }
      await OrderNotificationService.handleOrderCancelled({
        orderId: payload.orderId,
        reason: payload.reason,
      });
      return;
    }

    if (event.type === "INVENTORY_LOW_STOCK") {
      const inv = payload as unknown as {
        productId?: string;
        stock?: number;
        available?: number;
        threshold?: number;
      };
      logger.warn("Low stock alert", {
        productId: inv.productId,
        stock: inv.stock,
        available: inv.available,
        threshold: inv.threshold,
      });
      return;
    }

    throw new Error(`Unhandled outbox event type: ${event.type}`);
  }
}
