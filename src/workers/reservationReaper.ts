import "dotenv/config";
import { connectToDatabase } from "../index.js";
import { ReservationReaperService } from "../services/ReservationReaperService.js";
import { logger } from "../utils/logger.js";

async function main() {
  await connectToDatabase();
  await ReservationReaperService.runOnce({ quiet: false });
}

main().catch((err) => {
  logger.error("Reaper fatal", { error: String(err) });
  process.exitCode = 1;
});
