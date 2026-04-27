import crypto from "node:crypto";
import {
  OutboxEvent,
  type IOutboxEvent,
  type OutboxEventType,
  type OutboxPayloadMap,
} from "../models/index.js";
import { OrderNotificationService } from "./OrderNotificationService.js";
import { logger } from "../utils/logger.js";

type ProcessOptions = {
  batchSize?: number;
  lockTtlMs?: number;
  concurrency?: number;
};

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_LOCK_TTL_MS = 10 * 60_000;
const DEFAULT_CONCURRENCY = 5;

function backoffMs(attempts: number): number {
  // 1m, 5m, 15m, 1h, 6h
  const schedule = [60_000, 300_000, 900_000, 3_600_000, 21_600_000];
  return schedule[Math.min(attempts, schedule.length - 1)]!;
}

type HandlerFn<T extends OutboxEventType> = (
  payload: OutboxPayloadMap[T]
) => Promise<void>;

const handlerRegistry: {
  [K in OutboxEventType]?: HandlerFn<K>;
} = {
  ORDER_CONFIRMED: async (payload) => {
    if (!payload.orderId) {
      throw new Error("ORDER_CONFIRMED outbox payload missing orderId.");
    }
    await OrderNotificationService.handleOrderConfirmed({
      orderId: payload.orderId,
      paymentReference: payload.paymentReference,
    });
  },

  ORDER_DELIVERED: async (payload) => {
    if (!payload.orderId) {
      throw new Error("ORDER_DELIVERED outbox payload missing orderId.");
    }
    await OrderNotificationService.handleOrderDelivered({
      orderId: payload.orderId,
    });
  },

  ORDER_SHIPPED: async (payload) => {
    if (!payload.orderId) {
      throw new Error("ORDER_SHIPPED outbox payload missing orderId.");
    }
    await OrderNotificationService.handleOrderShipped({
      orderId: payload.orderId,
      note: payload.note,
    });
  },

  ORDER_CANCELLED: async (payload) => {
    if (!payload.orderId) {
      throw new Error("ORDER_CANCELLED outbox payload missing orderId.");
    }
    await OrderNotificationService.handleOrderCancelled({
      orderId: payload.orderId,
      reason: payload.reason,
    });
  },

  INVENTORY_LOW_STOCK: async (payload) => {
    logger.warn("Low stock alert", {
      productId: payload.productId,
      stock: payload.stock,
      available: payload.available,
      threshold: payload.threshold,
    });
  },

  WITHDRAWAL_RESERVED: async (payload) => {
    if (!payload.transactionId) {
      throw new Error(
        "WITHDRAWAL_RESERVED outbox payload missing transactionId."
      );
    }
    const { WithdrawalService } = await import("./WithdrawalService.js");
    await WithdrawalService.processWithdrawalTransfer(payload.transactionId);
  },
};

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
    const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
    const lockTtlMs = opts.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
    const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    while (processed < batchSize) {
      const slotsLeft = Math.min(concurrency, batchSize - processed);

      const claims = await Promise.all(
        Array.from({ length: slotsLeft }, () => this.claimNext(lockTtlMs))
      );

      const events = claims.filter((e): e is IOutboxEvent => e !== null);
      if (events.length === 0) break;

      const results = await Promise.allSettled(
        events.map((event) => this.processOne(event))
      );

      for (const result of results) {
        processed++;
        if (result.status === "fulfilled") {
          succeeded++;
        } else {
          failed++;
        }
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

  private static async processOne(event: IOutboxEvent): Promise<void> {
    const startMs = Date.now();

    try {
      await this.handle(event);

      if (!event.lockId) throw new Error("Outbox lockId missing on success.");

      await OutboxEvent.updateOne(
        { _id: event._id, lockId: event.lockId },
        {
          $set: {
            status: "DONE",
            completedAt: new Date(),
          },
          $unset: { lockedAt: 1, lockId: 1 },
        }
      );

      logger.info("Outbox event processed", {
        eventId: event._id.toString(),
        type: event.type,
        attempt: (event.attempts ?? 0) + 1,
        durationMs: Date.now() - startMs,
        outcome: "success",
      });
    } catch (err) {
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

      logger.warn("Outbox event failed", {
        eventId: event._id.toString(),
        type: event.type,
        attempt: attempts,
        durationMs: Date.now() - startMs,
        outcome: attempts >= 5 ? "exhausted" : "will_retry",
        error: err instanceof Error ? err.message : String(err),
      });

      throw err;
    }
  }

  private static async handle(event: IOutboxEvent): Promise<void> {
    const handler = handlerRegistry[event.type] as
      | ((payload: OutboxPayloadMap[OutboxEventType]) => Promise<void>)
      | undefined;

    if (!handler) {
      throw new Error(`Unhandled outbox event type: ${event.type}`);
    }

    await handler(event.payload);
  }
}
