/**
 * Paystack adapter — delegates to {@link PaystackClient} (`paystack-client.ts`).
 */

import type { PaymentMethod } from "../models/index.js";
import { PaystackClient } from "./paystack-client.js";
import type { ChargeParams, InitializeResult, PaymentGateway, VerifyResult } from "./types.js";

const PAYSTACK_CHANNEL_MAP: Partial<Record<PaymentMethod, string>> = {
  CARD: "card",
  BANK_TRANSFER: "bank_transfer",
  USSD: "ussd",
};

export class PaystackGateway implements PaymentGateway {
  async initialize(params: ChargeParams): Promise<InitializeResult> {
    const channels: string[] = [];
    const mapped = PAYSTACK_CHANNEL_MAP[params.paymentMethod];
    if (mapped) channels.push(mapped);

    const initParams: Parameters<
      typeof PaystackClient.initializeTransaction
    >[0] = {
      email: params.email,
      amount: params.amount,
      reference: params.reference,
      currency: params.currency,
    };
    if (channels.length > 0) initParams.channels = channels;
    if (params.callbackUrl) initParams.callbackUrl = params.callbackUrl;
    if (params.metadata) initParams.metadata = params.metadata;

    const data = await PaystackClient.initializeTransaction(initParams);

    return {
      authorizationUrl: data.authorization_url,
      accessCode: data.access_code,
      providerRef: data.reference,
    };
  }

  async verify(reference: string): Promise<VerifyResult> {
    const data = await PaystackClient.verifyTransaction(reference);

    if (data.status === "success") {
      return {
        success: true,
        providerRef: data.reference,
        amountPaid: data.amount,
        gatewayFee: data.fees,
        paidAt: data.paid_at,
        metadata: {
          channel: data.channel,
          gatewayResponse: data.gateway_response,
          authorization: data.authorization,
          ...(data.metadata ?? {}),
        },
      };
    }

    return {
      success: false,
      providerRef: data.reference,
      amountPaid: data.amount,
      gatewayFee: data.fees,
      failureReason: data.gateway_response || `Payment ${data.status}`,
      metadata: {
        channel: data.channel,
        gatewayResponse: data.gateway_response,
        ...(data.metadata ?? {}),
      },
    };
  }
}
