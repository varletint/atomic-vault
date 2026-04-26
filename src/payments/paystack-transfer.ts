/**
 * Paystack Transfer API — delegates to {@link PaystackClient} HTTP helpers.
 *
 * Endpoints:
 * - POST /transferrecipient  → create a bank-account recipient
 * - POST /transfer           → initiate an outbound transfer
 * - GET  /transfer/verify/:reference → verify a transfer status
 */

import { PAYSTACK_BASE_URL, paystackHeaders } from "../config/paystack.js";

/* ── Response shapes (Paystack docs) ── */

type PaystackRecipientResponse = {
  status: boolean;
  message: string;
  data: {
    active: boolean;
    recipient_code: string;
    name: string;
    type: string;
    details: {
      account_number: string;
      bank_code: string;
      bank_name: string;
    };
  };
};

type PaystackTransferResponse = {
  status: boolean;
  message: string;
  data: {
    reference: string;
    transfer_code: string;
    status: "pending" | "success" | "failed" | "reversed";
    amount: number;
    currency: string;
    reason: string;
  };
};

type PaystackVerifyTransferResponse = {
  status: boolean;
  message: string;
  data: {
    reference: string;
    transfer_code: string;
    status: "pending" | "success" | "failed" | "reversed" | "abandoned";
    amount: number;
    currency: string;
    reason: string;
  };
};

/* ── Public types ── */

export type CreateRecipientResult = {
  recipientCode: string;
  name: string;
  bankName: string;
};

export type InitiateTransferResult = {
  transferCode: string;
  reference: string;
  status: string;
};

export type VerifyTransferResult = {
  status: string;
  transferCode: string;
  amount: number;
  reference: string;
};

/* ── Client ── */

async function requestJson<T>(
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
    let json: unknown;
    if (text) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        /* ignore */
      }
    }

    if (!res.ok) {
      const msg =
        (json as { message?: string } | undefined)?.message ??
        res.statusText ??
        "Paystack Transfer request failed";
      throw new Error(`Paystack HTTP ${res.status}: ${msg}`);
    }
    if (json === undefined) {
      throw new Error("Paystack returned an empty response body.");
    }
    return json as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        `Paystack Transfer request timed out after ${timeoutMs}ms.`
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export class PaystackTransferClient {
  /**
   * Create a transfer recipient (bank account).
   * Paystack de-duplicates by account_number + bank_code so this is idempotent.
   */
  static async createRecipient(params: {
    bankCode: string;
    accountNumber: string;
    name: string;
    currency?: string;
  }): Promise<CreateRecipientResult> {
    const json = await requestJson<PaystackRecipientResponse>(
      "/transferrecipient",
      {
        method: "POST",
        body: JSON.stringify({
          type: "nuban",
          name: params.name,
          account_number: params.accountNumber,
          bank_code: params.bankCode,
          currency: params.currency ?? "NGN",
        }),
      }
    );

    if (!json.status) {
      throw new Error(
        `Paystack create recipient failed: ${json.message ?? "Unknown error"}`
      );
    }

    return {
      recipientCode: json.data.recipient_code,
      name: json.data.name,
      bankName: json.data.details.bank_name,
    };
  }

  /**
   * Initiate an outbound transfer to a recipient.
   */
  static async initiateTransfer(params: {
    amount: number;
    recipientCode: string;
    reference: string;
    reason?: string;
    currency?: string;
  }): Promise<InitiateTransferResult> {
    const json = await requestJson<PaystackTransferResponse>("/transfer", {
      method: "POST",
      body: JSON.stringify({
        source: "balance",
        amount: params.amount,
        recipient: params.recipientCode,
        reference: params.reference,
        reason: params.reason ?? "Withdrawal",
        currency: params.currency ?? "NGN",
      }),
    });

    if (!json.status) {
      throw new Error(
        `Paystack initiate transfer failed: ${json.message ?? "Unknown error"}`
      );
    }

    return {
      transferCode: json.data.transfer_code,
      reference: json.data.reference,
      status: json.data.status,
    };
  }

  static async verifyTransfer(
    reference: string
  ): Promise<VerifyTransferResult> {
    const json = await requestJson<PaystackVerifyTransferResponse>(
      `/transfer/verify/${encodeURIComponent(reference)}`,
      { method: "GET" }
    );

    if (!json.status) {
      throw new Error(
        `Paystack verify transfer failed: ${json.message ?? "Unknown error"}`
      );
    }

    return {
      status: json.data.status,
      transferCode: json.data.transfer_code,
      amount: json.data.amount,
      reference: json.data.reference,
    };
  }
}
