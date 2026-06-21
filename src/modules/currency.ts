export type CurrencyRates = Record<string, number>;

type FetchLike = (input: string, init?: { signal?: AbortSignal; cache?: RequestCache; next?: { revalidate?: number } }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export const DEFAULT_CURRENCY = "USD";

// Keep operational costs normalized to USD. CAD is the only non-USD currency
// currently expected from Lambenti order/item inputs; callers can inject a
// fresher rate in tests or future settings.
export const DEFAULT_CURRENCY_RATES: CurrencyRates = {
  CAD: 0.75
};

const DEFAULT_LIVE_RATE_URL = "https://open.er-api.com/v6/latest/USD";
const LIVE_RATE_CACHE_MS = 12 * 60 * 60 * 1000;
let liveRatesCache: { rates: CurrencyRates; fetchedAt: number; source: string } | null = null;

export type LiveCurrencyRatesResult = {
  rates: CurrencyRates;
  source: string;
  fetchedAt: string | null;
  fallback: boolean;
  error?: string;
};

export async function getLiveUsdConversionRates(options: {
  fetchImpl?: FetchLike;
  now?: number;
  maxAgeMs?: number;
  sourceUrl?: string;
} = {}): Promise<LiveCurrencyRatesResult> {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? LIVE_RATE_CACHE_MS;
  if (liveRatesCache && now - liveRatesCache.fetchedAt < maxAgeMs) {
    return {
      rates: liveRatesCache.rates,
      source: liveRatesCache.source,
      fetchedAt: new Date(liveRatesCache.fetchedAt).toISOString(),
      fallback: false
    };
  }

  const sourceUrl = options.sourceUrl ?? process.env.LAMBENTI_CURRENCY_RATE_URL ?? DEFAULT_LIVE_RATE_URL;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) return liveCurrencyFallback("fetch unavailable");

  try {
    const response = await fetchImpl(sourceUrl, { cache: "no-store", next: { revalidate: 43_200 } });
    if (!response.ok) throw new Error(`rate source returned HTTP ${response.status}`);
    const payload = await response.json();
    const rates = parseUsdBaseRates(payload);
    liveRatesCache = { rates, fetchedAt: now, source: sourceUrl };
    return { rates, source: sourceUrl, fetchedAt: new Date(now).toISOString(), fallback: false };
  } catch (error) {
    return liveCurrencyFallback(error instanceof Error ? error.message : "unknown currency-rate error");
  }
}

function liveCurrencyFallback(error: string): LiveCurrencyRatesResult {
  return {
    rates: DEFAULT_CURRENCY_RATES,
    source: "DEFAULT_CURRENCY_RATES",
    fetchedAt: null,
    fallback: true,
    error
  };
}

function parseUsdBaseRates(payload: unknown): CurrencyRates {
  if (typeof payload !== "object" || payload === null || !("rates" in payload)) {
    throw new Error("live rate payload did not include rates");
  }
  const rawRates = (payload as { rates?: unknown }).rates;
  if (typeof rawRates !== "object" || rawRates === null) throw new Error("live rate payload rates were invalid");

  const rates: CurrencyRates = {};
  for (const [currency, value] of Object.entries(rawRates)) {
    if (currency === DEFAULT_CURRENCY) continue;
    const usdToCurrency = Number(value);
    if (Number.isFinite(usdToCurrency) && usdToCurrency > 0) {
      rates[currency.trim().toUpperCase()] = roundUnitCost(1 / usdToCurrency);
    }
  }
  if (rates.CAD === undefined) throw new Error("live rate payload did not include CAD");
  return rates;
}

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

export function convertUnitCostToUsd(amount: number, currency?: string | null, options: CurrencyConversionOptions = {}) {
  const sourceCurrency = normalizeCurrencyCode(currency);
  if (sourceCurrency === DEFAULT_CURRENCY) return roundUnitCost(amount);

  const rate = options.rates?.[sourceCurrency] ?? DEFAULT_CURRENCY_RATES[sourceCurrency];
  if (rate === undefined) {
    if (options.strict ?? true) {
      throw new Error(`No USD conversion rate is configured for ${sourceCurrency}.`);
    }
    return roundUnitCost(amount);
  }

  return roundUnitCost(amount * rate);
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
    estimatedUnitCost: convertUnitCostToUsd(amount, currency, options),
    costCurrency: DEFAULT_CURRENCY
  };
}

export function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function roundUnitCost(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}
