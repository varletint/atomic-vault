/**
 * Guest checkout limits — amounts in kobo (NGN × 100) to align with
 * {@link IOrder} / {@link ITransaction} minor-unit convention.
 */
export const ORDER_GUEST_MAX_ITEMS_TOTAL_NGN = Math.max(
  1,
  parseInt(process.env.ORDER_GUEST_MAX_ITEMS_TOTAL_NGN ?? "5000", 10) || 5000,
);

/** Maximum sum of line-item subtotals (excludes delivery fee). */
export const ORDER_GUEST_MAX_ITEMS_TOTAL_KOBO =
  ORDER_GUEST_MAX_ITEMS_TOTAL_NGN * 100;

/** Instant settlement — guest checkout must not use deferred / cash-on-delivery methods. */
export const GUEST_INSTANT_PAYMENT_METHODS = [
  "CARD",
  "BANK_TRANSFER",
  "WALLET",
  "USSD",
] as const;
