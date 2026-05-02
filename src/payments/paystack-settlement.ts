import { PAYSTACK_BASE_URL, paystackHeaders } from "../config/paystack.js";
import { logger } from "../utils/logger.js";

type PaystackSettlementListItem = {
  id: number;
  domain: string;
  status: string;
  currency: string;
  integration: number;
  total_amount: number;
  total_fees: number;
  total_processed: number;
  effective_amount: number;
  settled_by: string | null;
  settlement_date: string;
  created_at: string;
  updated_at: string;
};

type PaystackSettlementTransaction = {
  reference: string;
  amount: number;
  fees: number;
  currency: string;
  status: string;
};

export type SettlementListResult = {
  id: number;
  status: string;
  currency: string;
  totalAmount: number;
  totalFees: number;
  netAmount: number;
  settledAt: string;
};

export type SettlementTransactionResult = {
  reference: string;
  grossAmount: number;
  fee: number;
  netAmount: number;
};

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
      } catch {}
    }

    if (!res.ok) {
      const msg =
        (json as { message?: string } | undefined)?.message ??
        res.statusText ??
        "Paystack Settlement request failed";
      throw new Error(`Paystack HTTP ${res.status}: ${msg}`);
    }
    if (json === undefined) {
      throw new Error("Paystack returned an empty response body.");
    }
    return json as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        `Paystack Settlement request timed out after ${timeoutMs}ms.`
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export class PaystackSettlementClient {
  static async fetchSettlements(
    params: {
      from?: string;
      to?: string;
      perPage?: number;
      page?: number;
    } = {}
  ): Promise<SettlementListResult[]> {
    const qs = new URLSearchParams();
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    qs.set("perPage", String(params.perPage ?? 50));
    qs.set("page", String(params.page ?? 1));

    const json = await requestJson<{
      status: boolean;
      message: string;
      data: PaystackSettlementListItem[];
    }>(`/settlement?${qs.toString()}`, { method: "GET" });

    if (!json.status) {
      throw new Error(
        `Paystack fetch settlements failed: ${json.message ?? "Unknown error"}`
      );
    }

    logger.info(
      `[Settlement] Fetched ${json.data.length} settlements from Paystack`
    );

    return json.data.map((s) => ({
      id: s.id,
      status: s.status,
      currency: s.currency,
      totalAmount: s.total_amount,
      totalFees: s.total_fees,
      netAmount: s.effective_amount,
      settledAt: s.settlement_date,
    }));
  }

  static async fetchSettlementTransactions(
    settlementId: number,
    params: { perPage?: number; page?: number } = {}
  ): Promise<SettlementTransactionResult[]> {
    const qs = new URLSearchParams();
    qs.set("perPage", String(params.perPage ?? 200));
    qs.set("page", String(params.page ?? 1));

    const json = await requestJson<{
      status: boolean;
      message: string;
      data: PaystackSettlementTransaction[];
    }>(`/settlement/${settlementId}/transactions?${qs.toString()}`, {
      method: "GET",
    });

    if (!json.status) {
      throw new Error(
        `Paystack fetch settlement transactions failed: ${
          json.message ?? "Unknown error"
        }`
      );
    }

    return json.data.map((t) => ({
      reference: t.reference,
      grossAmount: t.amount,
      fee: t.fees,
      netAmount: t.amount - t.fees,
    }));
  }
}
