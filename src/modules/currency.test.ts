import { describe, expect, it } from "vitest";
import { convertToUsd, getLiveUsdConversionRates, normalizeCostToUsd } from "./currency";

function mockRateFetch(rates: Record<string, number>, ok = true) {
  return async () => ({
    ok,
    status: ok ? 200 : 503,
    json: async () => ({ rates })
  });
}

describe("currency normalization", () => {
  it("converts configured non-USD currencies to USD", () => {
    expect(convertToUsd(10, "CAD", { rates: { CAD: 0.75 } })).toBe(7.5);
    expect(normalizeCostToUsd(10, "CAD", { rates: { CAD: 0.75 } })).toEqual({
      estimatedUnitCost: 7.5,
      costCurrency: "USD"
    });
  });

  it("rejects unsupported currencies instead of treating their face value as USD", () => {
    expect(() => convertToUsd(10, "CNY")).toThrow("No USD conversion rate is configured for CNY.");
    expect(() => normalizeCostToUsd(10, "EUR")).toThrow("No USD conversion rate is configured for EUR.");
  });

  it("loads live USD conversion rates from a USD-base source", async () => {
    const result = await getLiveUsdConversionRates({
      fetchImpl: mockRateFetch({ USD: 1, CAD: 1.25, EUR: 0.8 }),
      now: 1_000,
      maxAgeMs: 0,
      sourceUrl: "mock://rates"
    });

    expect(result.fallback).toBe(false);
    expect(result.rates.CAD).toBe(0.8);
    expect(result.rates.EUR).toBe(1.25);
  });

  it("falls back to configured static rates when the live source fails", async () => {
    const result = await getLiveUsdConversionRates({
      fetchImpl: mockRateFetch({}, false),
      now: 2_000,
      maxAgeMs: 0,
      sourceUrl: "mock://down"
    });

    expect(result.fallback).toBe(true);
    expect(result.rates.CAD).toBe(0.75);
  });
});
