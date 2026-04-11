/**
 * @deprecated Migration: active gateway types + `resolveGateway` live in `src/payments/`.
 * This file re-exports them so older import paths keep working.
 *
 * ---------------------------------------------------------------------------
 * LEGACY IMPLEMENTATION (pre-migration, kept for reference — do not restore)
 * ---------------------------------------------------------------------------
 *
 * import type { PaymentMethod } from "../models/index.js";
 * import { PaystackClient } from "../payments/paystack-client.js";
 *
 * export type ChargeParams = { ... };
 * export type InitializeResult = { ... };
 * export type VerifyResult = { ... };
 * export interface PaymentGateway { ... }
 *
 * const PAYSTACK_CHANNEL_MAP = { ... };
 *
 * class PaystackGateway implements PaymentGateway {
 *   async initialize(params: ChargeParams): Promise<InitializeResult> { ... }
 *   async verify(reference: string): Promise<VerifyResult> { ... }
 * }
 *
 * const gateways: Record<string, PaymentGateway> = { paystack: new PaystackGateway() };
 *
 * export function resolveGateway(provider: string): PaymentGateway { ... }
 */

export {
  resolveGateway,
  type PaymentGateway,
  type ChargeParams,
  type InitializeResult,
  type VerifyResult,
} from "../payments/index.js";
