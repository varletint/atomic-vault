import crypto from "node:crypto";
import {
  PAYSTACK_BASE_URL,
  PAYSTACK_WEBHOOK_SECRET,
  paystackHeaders,
} from "../config/paystack.js";

type PaystackInitializeParams = {
  email: string;
  amount: number;
  reference?: string;
  currency?: string;
  channels?: string[];
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
};

type PaystackInitializeResponse = {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
};

type PaystackVerifyResponse = {
  status: boolean;
  message: string;
  data: {
    id: number;
    status: "success" | "failed" | "abandoned";
    reference: string;
    amount: number;
    currency: string;
    gateway_response: string;
    paid_at: string | null;
    channel: string;
    metadata: Record<string, unknown> | null;
    authorization: Record<string, unknown>;
  };
};

export class PaystackService {
  static async initializeTransaction(
    params: PaystackInitializeParams
  ): Promise<PaystackInitializeResponse["data"]> {
    const body: Record<string, unknown> = {
      email: params.email,
      amount: String(params.amount),
    };
    if (params.reference) body.reference = params.reference;
    if (params.currency) body.currency = params.currency;
    if (params.channels) body.channels = params.channels;
    if (params.callbackUrl) body.callback_url = params.callbackUrl;
    if (params.metadata) body.metadata = params.metadata;

    const res = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
      method: "POST",
      headers: paystackHeaders(),
      body: JSON.stringify(body),
    });

    const json = (await res.json()) as PaystackInitializeResponse;

    if (!res.ok || !json.status) {
      throw new Error(
        `Paystack initialize failed: ${json.message ?? res.statusText}`
      );
    }

    return json.data;
  }

  static async verifyTransaction(
    reference: string
  ): Promise<PaystackVerifyResponse["data"]> {
    const res = await fetch(
      `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(
        reference
      )}`,
      { method: "GET", headers: paystackHeaders() }
    );

    const json = (await res.json()) as PaystackVerifyResponse;

    if (!res.ok || !json.status) {
      throw new Error(
        `Paystack verify failed: ${json.message ?? res.statusText}`
      );
    }

    return json.data;
  }

  static validateWebhookSignature(
    rawBody: string | Buffer,
    signatureHeader: string
  ): boolean {
    const hash = crypto
      .createHmac("sha512", PAYSTACK_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");

    return hash === signatureHeader;
  }
}
