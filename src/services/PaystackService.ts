/**
 * @deprecated Legacy module path. Active implementation: `src/payments/paystack-client.ts` (`PaystackClient`).
 * This file re-exports `PaystackClient` as `PaystackService` so old imports keep working.
 *
 * ---------------------------------------------------------------------------
 * LEGACY IMPLEMENTATION (moved to `PaystackClient` — kept here as reference only)
 * ---------------------------------------------------------------------------
 *
 * // import crypto from "node:crypto";
 * // import { PAYSTACK_BASE_URL, PAYSTACK_WEBHOOK_SECRET, paystackHeaders } from "../config/paystack.js";
 * //
 * // export class PaystackService {
 * //   private static async requestJson<T>(path, init) { ... fetch + timeout ... }
 * //   static async initializeTransaction(params) { ... }
 * //   static async verifyTransaction(reference) { ... }
 * //   static validateWebhookSignature(rawBody, signatureHeader) { ... HMAC sha512 ... }
 * // }
 */

export { PaystackClient as PaystackService } from "../payments/paystack-client.js";
