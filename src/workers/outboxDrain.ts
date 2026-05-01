import "dotenv/config";
import mongoose from "mongoose";
import { OutboxEvent } from "../models/index.js";
import { OutboxProcessor } from "../services/OutboxProcessor.js";
import { logger } from "../utils/logger.js";

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/order-system";
const POLL_INTERVAL_MS =
  Number(process.env.OUTBOX_POLL_INTERVAL_MS) || 30 * 60_000; // 30 minutes
const BATCH_SIZE = Number(process.env.OUTBOX_BATCH_SIZE) || 25;
const PURGE_TTL_MS = 24 * 60 * 60_000; // 24 hours

async function purgeCompleted() {
  const cutoff = new Date(Date.now() - PURGE_TTL_MS);
  const { deletedCount } = await OutboxEvent.deleteMany({
    status: { $in: ["DONE", "FAILED"] },
    updatedAt: { $lte: cutoff },
  });
  if (deletedCount > 0) {
    logger.info(`[OutboxDrain] Purged ${deletedCount} old events`);
  }
}

async function drainLoop() {
  await mongoose.connect(MONGODB_URI, {
    bufferCommands: false,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  });
  logger.info(
    `[OutboxDrain] MongoDB connected. Safety-net polling every ${
      POLL_INTERVAL_MS / 60_000
    }min, batch size ${BATCH_SIZE}`
  );

  const tick = async () => {
    try {
      const result = await OutboxProcessor.drainOnce({ batchSize: BATCH_SIZE });
      if (result.processed > 0) {
        logger.info("[OutboxDrain] Drain cycle complete", {
          processed: result.processed,
          succeeded: result.succeeded,
          failed: result.failed,
        });
      }
      await purgeCompleted();
    } catch (err) {
      logger.error("[OutboxDrain] Drain cycle error", {
        error: String(err),
      });
    }
  };

  // Initial drain on startup
  await tick();

  // Safety-net: poll every 30 minutes for any missed events
  setInterval(() => {
    logger.info("[OutboxDrain] Safety-net poll triggered");
    void tick();
  }, POLL_INTERVAL_MS);
}

drainLoop().catch((err) => {
  logger.error("[OutboxDrain] Fatal startup error", { error: String(err) });
  process.exitCode = 1;
});
