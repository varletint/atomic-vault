import "dotenv/config";
import { connectToDatabase } from "../index.js";
import { ReservationReaperService } from "../services/ReservationReaperService.js";

async function main() {
  await connectToDatabase();
  await ReservationReaperService.runOnce({ quiet: false });
}

main().catch((err) => {
  console.error("[reaper] fatal", err);
  process.exitCode = 1;
});
