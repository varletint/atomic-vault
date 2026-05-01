const PAYSTACK_SECRET_KEY =
  process.env.PAYSTACK_SECRET_KEY ??
  "sk_test_1d3f0d7cd61c3a8476b995c7b0597daa67eb2d2f";
const PAYSTACK_WEBHOOK_SECRET = process.env.PAYSTACK_WEBHOOK_SECRET ?? "12";
const PAYSTACK_BASE_URL = "https://api.paystack.co";

import { logger } from "../utils/logger.js";

if (!PAYSTACK_SECRET_KEY) {
  logger.warn(
    "PAYSTACK_SECRET_KEY is not set. Payment initialization will fail."
  );
}

function paystackHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    "Content-Type": "application/json",
  };
}

export {
  PAYSTACK_SECRET_KEY,
  PAYSTACK_WEBHOOK_SECRET,
  PAYSTACK_BASE_URL,
  paystackHeaders,
};
