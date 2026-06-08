export type CurrencyRates = Record<string, number>;

export const DEFAULT_CURRENCY = "USD";

// Keep operational costs normalized to USD. CAD is the only non-USD currency
// currently expected from Lambenti order/item inputs; callers can inject a
// fresher rate in tests or future settings.
export const DEFAULT_CURRENCY_RATES: CurrencyRates = {
  CAD: 0.75
};

export type CurrencyConversionOptions = {
  rates?: CurrencyRates;
  strict?: boolean;
};

export function normalizeCurrencyCode(currency?: string | null) {
  const normalized = currency?.trim().toUpperCase();
  return normalized || DEFAULT_CURRENCY;
}

export function convertToUsd(amount: number, currency?: string | null, options: CurrencyConversionOptions = {}) {
  const sourceCurrency = normalizeCurrencyCode(currency);
  if (sourceCurrency === DEFAULT_CURRENCY) return roundCurrency(amount);

  const rate = options.rates?.[sourceCurrency] ?? DEFAULT_CURRENCY_RATES[sourceCurrency];
  if (rate === undefined) {
    if (options.strict ?? true) {
      throw new Error(`No USD conversion rate is configured for ${sourceCurrency}.`);
    }
    return roundCurrency(amount);
  }

  return roundCurrency(amount * rate);
}

export function isUsdConversionSupported(currency?: string | null, options: CurrencyConversionOptions = {}) {
  const sourceCurrency = normalizeCurrencyCode(currency);
  if (sourceCurrency === DEFAULT_CURRENCY) return true;
  return (options.rates?.[sourceCurrency] ?? DEFAULT_CURRENCY_RATES[sourceCurrency]) !== undefined;
}

export function normalizeCostToUsd(
  amount: number | null | undefined,
  currency?: string | null,
  options: CurrencyConversionOptions = {}
): { estimatedUnitCost: number | undefined; costCurrency: typeof DEFAULT_CURRENCY } {
  if (amount === null || amount === undefined) {
    return { estimatedUnitCost: undefined, costCurrency: DEFAULT_CURRENCY };
  }

  return {
    estimatedUnitCost: convertToUsd(amount, currency, options),
    costCurrency: DEFAULT_CURRENCY
  };
}

export function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
