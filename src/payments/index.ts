/**
 * Public payment API — gateway types, `resolveGateway`, `parsePaystackWebhook`.
 *
 * `PaystackClient` (`paystack-client.ts`) is **internal** to this folder: only `paystack-adapter` and
 * `webhook` import it. Legacy `services/PaystackService.ts` re-exports it for old import paths.
 */

export type {
  ChargeParams,
  InitializeResult,
  VerifyResult,
  PaymentGateway,
} from "./types.js";
export { PaystackGateway } from "./paystack-adapter.js";
export { resolveGateway } from "./resolve-gateway.js";
export {
  parsePaystackWebhook,
  type PaystackWebhookParseResult,
  type PaystackWebhookParseSuccess,
  type PaystackWebhookParseFailure,
} from "./webhook.js";
