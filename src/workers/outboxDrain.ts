import "dotenv/config";
import { connectToDatabase } from "../index.js";
import { OutboxProcessor } from "../services/OutboxProcessor.js";

async function main() {
  await connectToDatabase();
  const result = await OutboxProcessor.drainOnce({
    batchSize: process.env.OUTBOX_BATCH_SIZE
      ? Number(process.env.OUTBOX_BATCH_SIZE)
      : 25,
  });
  console.log(`[outbox] processed=${result.processed} ok=${result.succeeded} failed=${result.failed}`);
}

main().catch((err) => {
  console.error("[outbox] fatal", err);
  process.exitCode = 1;
});

