const DEFAULT_CURRENCY = process.env.DEFAULT_CURRENCY?.trim() || "NGN";
const DEFAULT_LOCALE = process.env.DEFAULT_LOCALE?.trim() || "en-NG";

export function formatMinorCurrency(
  amountMinor: number,
  options?: { currency?: string; locale?: string }
): string {
  const currency = options?.currency?.trim() || DEFAULT_CURRENCY;
  const locale = options?.locale?.trim() || DEFAULT_LOCALE;

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor);
}
