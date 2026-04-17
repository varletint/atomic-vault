import type { PaymentMethod } from "../models/index.js";

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
  amountPaid?: number;
  gatewayFee?: number;
  failureReason?: string;
  paidAt?: string | null;
  metadata?: Record<string, unknown>;
};

export interface PaymentGateway {
  initialize(params: ChargeParams): Promise<InitializeResult>;
  verify(reference: string): Promise<VerifyResult>;
}
