/**
 * Paystack API client — single place for HTTP + webhook HMAC.
 * Env and headers: `src/config/paystack.ts`.
 */

import crypto from "node:crypto";
import {
  PAYSTACK_BASE_URL,
  PAYSTACK_WEBHOOK_SECRET,
  paystackHeaders,
} from "../config/paystack.js";

type PaystackApiError = {
  status?: boolean;
  message?: string;
  data?: unknown;
};

export type PaystackInitializeParams = {
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
    fees?: number;
    currency: string;
    gateway_response: string;
    paid_at: string | null;
    channel: string;
    metadata: Record<string, unknown> | null;
    authorization: Record<string, unknown>;
  };
};

export class PaystackClient {
  private static async requestJson<T>(
    path: string,
    init: RequestInit & { timeoutMs?: number } = {}
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutMs = init.timeoutMs ?? 15_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
        ...init,
        headers: {
          ...paystackHeaders(),
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });

      const text = await res.text();
      let json: unknown = undefined;
      if (text) {
        try {
          json = JSON.parse(text) as unknown;
        } catch {
          // ignore; fall back to status text
        }
      }

      if (!res.ok) {
        const msg =
          (json as PaystackApiError | undefined)?.message ??
          res.statusText ??
          "Paystack request failed";
        throw new Error(`Paystack HTTP ${res.status}: ${msg}`);
      }

      if (json === undefined) {
        throw new Error("Paystack returned an empty response body.");
      }

      return json as T;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(`Paystack request timed out after ${timeoutMs}ms.`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

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

    const json = await this.requestJson<PaystackInitializeResponse>(
      "/transaction/initialize",
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );

    if (!json.status) {
      throw new Error(
        `Paystack initialize failed: ${json.message ?? "Unknown error"}`
      );
    }

    return json.data;
  }

  static async verifyTransaction(
    reference: string
  ): Promise<PaystackVerifyResponse["data"]> {
    const json = await this.requestJson<PaystackVerifyResponse>(
      `/transaction/verify/${encodeURIComponent(reference)}`,
      { method: "GET" }
    );

    if (!json.status) {
      throw new Error(
        `Paystack verify failed: ${json.message ?? "Unknown error"}`
      );
    }

    return json.data;
  }

  static validateWebhookSignature(
    rawBody: string | Buffer,
    signatureHeader: string
  ): boolean {
    if (!PAYSTACK_WEBHOOK_SECRET) return false;
    if (!signatureHeader) return false;

    const hash = crypto
      .createHmac("sha512", PAYSTACK_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");

    try {
      const a = Buffer.from(hash, "utf8");
      const b = Buffer.from(signatureHeader, "utf8");
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
}
