import "dotenv/config";
import { connectToDatabase } from "../index.js";
import { OutboxProcessor } from "../services/OutboxProcessor.js";
import { logger } from "../utils/logger.js";

async function main() {
  await connectToDatabase();
  const result = await OutboxProcessor.drainOnce({
    batchSize: process.env.OUTBOX_BATCH_SIZE
      ? Number(process.env.OUTBOX_BATCH_SIZE)
      : 25,
  });
  logger.info("Outbox drain complete", {
    processed: result.processed,
    succeeded: result.succeeded,
    failed: result.failed,
  });
}

main().catch((err) => {
  logger.error("Outbox drain fatal", { error: String(err) });
  process.exitCode = 1;
});
