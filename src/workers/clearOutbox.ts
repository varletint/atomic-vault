import "dotenv/config";
import mongoose from "mongoose";
import { OutboxEvent } from "../models/index.js";

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/order-system";

/**
 * Clears queued outbox rows (PENDING / PROCESSING) so they are not delivered.
 * Set OUTBOX_CLEAR_ALL=1 to delete every document in the collection (including DONE).
 */
async function main() {
  await mongoose.connect(MONGODB_URI, {
    bufferCommands: false,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  });
  console.log("MongoDB connected successfully");

  const clearAll =
    process.env.OUTBOX_CLEAR_ALL === "1" ||
    process.env.OUTBOX_CLEAR_ALL === "true";

  const filter = clearAll
    ? {}
    : { status: { $in: ["PENDING", "PROCESSING"] } };

  const result = await OutboxEvent.deleteMany(filter);
  console.log(
    `[outbox:clear] deleted=${result.deletedCount} filter=${clearAll ? "ALL" : "PENDING+PROCESSING"}`
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("[outbox:clear] fatal", err);
  process.exitCode = 1;
});
