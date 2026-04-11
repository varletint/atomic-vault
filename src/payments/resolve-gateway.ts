import type { PaymentGateway } from "./types.js";
import { PaystackGateway } from "./paystack-adapter.js";

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
