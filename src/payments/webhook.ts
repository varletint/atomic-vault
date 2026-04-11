/**
 * Paystack webhook: HMAC via {@link PaystackClient}. Parsing stays framework-agnostic (Buffer in).
 */

import { PaystackClient } from "./paystack-client.js";

export type PaystackWebhookParseSuccess = {
  ok: true;
  event: string;
  reference?: string;
  raw: Record<string, unknown>;
};

export type PaystackWebhookParseFailure = {
  ok: false;
  reason: "missing_signature" | "invalid_signature" | "invalid_json";
};

export type PaystackWebhookParseResult =
  | PaystackWebhookParseSuccess
  | PaystackWebhookParseFailure;

export function parsePaystackWebhook(
  rawBody: Buffer,
  signatureHeader: string | undefined
): PaystackWebhookParseResult {
  if (!signatureHeader?.trim()) {
    return { ok: false, reason: "missing_signature" };
  }

  const valid = PaystackClient.validateWebhookSignature(
    rawBody,
    signatureHeader
  );
  if (!valid) {
    return { ok: false, reason: "invalid_signature" };
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  const event = typeof raw.event === "string" ? raw.event : "";
  const data = raw.data;
  let reference: string | undefined;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const ref = (data as Record<string, unknown>).reference;
    if (typeof ref === "string") reference = ref;
  }

  return { ok: true, event, reference, raw };
}
