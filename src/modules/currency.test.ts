import { describe, expect, it } from "vitest";
import { convertToUsd, normalizeCostToUsd } from "./currency";

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
});
