import "dotenv/config";
import mongoose from "mongoose";
import { OutboxEvent } from "../models/index.js";
import { logger } from "../utils/logger.js";

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/order-system";

async function main() {
  await mongoose.connect(MONGODB_URI, {
    bufferCommands: false,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  });
  logger.info("MongoDB connected successfully");

  const clearAll =
    process.env.OUTBOX_CLEAR_ALL === "1" ||
    process.env.OUTBOX_CLEAR_ALL === "true";

  const filter = clearAll ? {} : { status: { $in: ["PENDING", "PROCESSING"] } };

  const result = await OutboxEvent.deleteMany(filter);
  logger.info("Outbox clear complete", {
    deleted: result.deletedCount,
    filter: clearAll ? "ALL" : "PENDING+PROCESSING",
  });

  await mongoose.disconnect();
}

main().catch((err) => {
  logger.error("Outbox clear fatal", { error: String(err) });
  process.exitCode = 1;
});
