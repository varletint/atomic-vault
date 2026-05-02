import "dotenv/config";
import mongoose from "mongoose";
import { SettlementService } from "../services/SettlementService.js";
import { logger } from "../utils/logger.js";

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/order-system";
const POLL_INTERVAL_MS =
  Number(process.env.SETTLEMENT_POLL_INTERVAL_MS) || 6 * 60 * 60_000; // 6 hours
const LOOKBACK_HOURS = Number(process.env.SETTLEMENT_LOOKBACK_HOURS) || 48;

async function syncLoop() {
  await mongoose.connect(MONGODB_URI, {
    bufferCommands: false,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  });
  logger.info(
    `[SettlementSync] MongoDB connected. Polling every ${
      POLL_INTERVAL_MS / 3_600_000
    }h, lookback ${LOOKBACK_HOURS}h`
  );

  const tick = async () => {
    try {
      const result = await SettlementService.syncFromPaystack(LOOKBACK_HOURS);
      logger.info("[SettlementSync] Sync cycle complete", result);
    } catch (err) {
      logger.error("[SettlementSync] Sync cycle error", {
        error: String(err),
      });
    }
  };

  // Initial sync on startup
  await tick();

  // Safety-net: poll every 6 hours
  setInterval(() => {
    logger.info("[SettlementSync] Safety-net poll triggered");
    void tick();
  }, POLL_INTERVAL_MS);
}

syncLoop().catch((err) => {
  logger.error("[SettlementSync] Fatal startup error", { error: String(err) });
  process.exitCode = 1;
});
