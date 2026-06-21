import { describe, expect, it } from "vitest";
import { allocateOrderLevelCost, calculateLandedOrderLineCosts } from "./unit-cost-engine";

describe("unit-cost-engine", () => {
  it("splits order shipping by extended item value and preserves exact cents", () => {
    const lines = [
      { quantity: 10, unitPrice: 2.5, lineTotal: 25 },
      { quantity: 5, unitPrice: 3, lineTotal: 15 },
      { quantity: 1000, unitPrice: 0.06, lineTotal: 60 }
    ];

    const shipping = allocateOrderLevelCost(4, lines);

    expect(shipping).toEqual([1, 0.6, 2.4]);
    expect(shipping.reduce((total, value) => total + value, 0)).toBeCloseTo(4, 2);
  });

  it("uses largest-remainder rounding so awkward totals still sum exactly", () => {
    const shipping = allocateOrderLevelCost(0.05, [
      { quantity: 1, lineTotal: 1 },
      { quantity: 1, lineTotal: 1 },
      { quantity: 1, lineTotal: 1 }
    ]);

    expect(shipping).toEqual([0.02, 0.02, 0.01]);
    expect(shipping.reduce((total, value) => total + value, 0)).toBeCloseTo(0.05, 2);
  });

  it("computes 4-decimal landed unit costs from product, shipping, duty, and fee charges", () => {
    const landed = calculateLandedOrderLineCosts([
      { quantity: 100, unitPrice: 0.86, lineTotal: 86 },
      { quantity: 200, unitPrice: 1.93, lineTotal: 386 }
    ], {
      shipping: 25.5,
      duty: 12.34,
      brokerage: 4.56,
      other: 1.11
    });

    expect(landed.map((line) => line.shippingAllocated)).toEqual([4.65, 20.85]);
    expect(landed.reduce((total, line) => total + line.shippingAllocated + line.dutyAllocated + line.brokerageAllocated + line.otherAllocated, 0)).toBeCloseTo(43.51, 2);
    expect(landed[0].landedUnitCost).toBe(0.9393);
    expect(landed[1].landedUnitCost).toBe(2.1079);
  });
});
