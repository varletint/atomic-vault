/**
 * One-off script: sends verification emails to ALL users with UNVERIFIED status.
 *
 * Usage:  npx tsx scripts/send-verification-emails.ts
 */
import "dotenv/config";
import mongoose from "mongoose";
import { User } from "../src/models/index.js";
import { generateEmailVerificationToken } from "../src/utils/jwt.js";
import { sendVerificationEmail } from "../src/services/EmailService.js";

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/order-system";

const CLIENT_URL = (process.env.CLIENT_URL ?? "http://localhost:5173").replace(
  /\/$/,
  ""
);

async function main() {
  console.log("Connecting to MongoDB…");
  await mongoose.connect(MONGODB_URI);
  console.log("Connected.\n");

  const unverifiedUsers = await User.find({
    status: "UNVERIFIED",
    isEmailVerified: false,
  }).select("_id email name");

  if (unverifiedUsers.length === 0) {
    console.log("No unverified users found. Nothing to do.");
    return;
  }

  console.log(`Found ${unverifiedUsers.length} unverified user(s):\n`);

  let sent = 0;
  let failed = 0;

  for (const user of unverifiedUsers) {
    const token = generateEmailVerificationToken(user._id.toString());
    const verifyUrl = `${CLIENT_URL}/verify-email?token=${token}`;

    try {
      await sendVerificationEmail(user.email, verifyUrl);
      console.log(`  ✔ Sent to ${user.email}`);
      sent++;
    } catch (err) {
      console.error(`  ✘ Failed for ${user.email}:`, err);
      failed++;
    }
  }

  console.log(`\nDone. Sent: ${sent}, Failed: ${failed}`);
}

main()
  .catch((err) => {
    console.error("Script failed:", err);
    process.exit(1);
  })
  .finally(() => mongoose.disconnect());
