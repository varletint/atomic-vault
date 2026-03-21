import type { PaymentMethod } from "../models/index.js";
import { PaystackService } from "./PaystackService.js";

export type ChargeParams = {
  email: string;
  amount: number;
  currency: string;
  reference: string;
  paymentMethod: PaymentMethod;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
};

export type InitializeResult = {
  authorizationUrl: string;
  accessCode: string;
  providerRef: string;
};

export type VerifyResult = {
  success: boolean;
  providerRef: string;
  failureReason?: string;
  paidAt?: string | null;
  metadata?: Record<string, unknown>;
};

export interface PaymentGateway {
  initialize(params: ChargeParams): Promise<InitializeResult>;
  verify(reference: string): Promise<VerifyResult>;
}

const PAYSTACK_CHANNEL_MAP: Partial<Record<PaymentMethod, string>> = {
  CARD: "card",
  BANK_TRANSFER: "bank_transfer",
  USSD: "ussd",
};

class PaystackGateway implements PaymentGateway {
  async initialize(params: ChargeParams): Promise<InitializeResult> {
    const channels: string[] = [];
    const mapped = PAYSTACK_CHANNEL_MAP[params.paymentMethod];
    if (mapped) channels.push(mapped);

    // @Supabase@Idris001

    const initParams: Parameters<
      typeof PaystackService.initializeTransaction
    >[0] = {
      email: params.email,
      amount: params.amount,
      reference: params.reference,
      currency: params.currency,
    };
    if (channels.length > 0) initParams.channels = channels;
    if (params.callbackUrl) initParams.callbackUrl = params.callbackUrl;
    if (params.metadata) initParams.metadata = params.metadata;

    const data = await PaystackService.initializeTransaction(initParams);

    return {
      authorizationUrl: data.authorization_url,
      accessCode: data.access_code,
      providerRef: data.reference,
    };
  }

  async verify(reference: string): Promise<VerifyResult> {
    const data = await PaystackService.verifyTransaction(reference);

    if (data.status === "success") {
      return {
        success: true,
        providerRef: data.reference,
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
      failureReason: data.gateway_response || `Payment ${data.status}`,
      metadata: {
        channel: data.channel,
        gatewayResponse: data.gateway_response,
        ...(data.metadata ?? {}),
      },
    };
  }
}

const gateways: Record<string, PaymentGateway> = {
  paystack: new PaystackGateway(),
};

export function resolveGateway(provider: string): PaymentGateway {
  const gateway = gateways[provider.toLowerCase()];
  if (!gateway) {
    throw new Error(`Unsupported payment provider: ${provider}`);
  }
  return gateway;
}
