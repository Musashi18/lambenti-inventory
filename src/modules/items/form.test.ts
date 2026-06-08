import { describe, expect, it } from "vitest";
import { CostConfidence, ItemCategory, LifecycleStatus, Unit } from "@prisma/client";
import { parseItemFormData } from "./form";

function makeFormData(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  const values = {
    sku: "LED-COB-12V-3000K",
    manufacturerPartNo: "",
    supplierSku: "",
    description: "12V COB strip, 3000K",
    category: ItemCategory.COMPONENT,
    unit: Unit.EACH,
    reorderPoint: "10",
    targetStock: "40",
    leadTimeDays: "14",
    preferredSupplierId: "",
    lifecycleStatus: LifecycleStatus.ACTIVE,
    estimatedUnitCost: "1.71",
    costCurrency: "CAD",
    costConfidence: CostConfidence.CONFIRMED,
    costSourceRef: "COB strip order"
  };

  for (const [key, value] of Object.entries({ ...values, ...overrides })) {
    formData.set(key, value);
  }

  return formData;
}

describe("parseItemFormData", () => {
  it("normalizes blank optional item edit fields to undefined", () => {
    const parsed = parseItemFormData(
      makeFormData({
        manufacturerPartNo: "",
        supplierSku: "",
        preferredSupplierId: "",
        estimatedUnitCost: "",
        costSourceRef: ""
      })
    );

    expect(parsed.manufacturerPartNo).toBeUndefined();
    expect(parsed.supplierSku).toBeUndefined();
    expect(parsed.preferredSupplierId).toBeUndefined();
    expect(parsed.estimatedUnitCost).toBeUndefined();
    expect(parsed.costSourceRef).toBeUndefined();
  });

  it("parses editable numeric and enum item fields", () => {
    const parsed = parseItemFormData(
      makeFormData({
        category: ItemCategory.FINISHED_GOOD,
        unit: Unit.METER,
        reorderPoint: "3",
        targetStock: "25",
        leadTimeDays: "30",
        lifecycleStatus: LifecycleStatus.NRND,
        costConfidence: CostConfidence.QUOTED
      })
    );

    expect(parsed).toMatchObject({
      category: ItemCategory.FINISHED_GOOD,
      unit: Unit.METER,
      reorderPoint: 3,
      targetStock: 25,
      leadTimeDays: 30,
      lifecycleStatus: LifecycleStatus.NRND,
      costConfidence: CostConfidence.QUOTED
    });
  });

  it("normalizes CAD item cost inputs into USD persisted values", () => {
    const parsed = parseItemFormData(makeFormData({ estimatedUnitCost: "10.00", costCurrency: "CAD" }), { rates: { CAD: 0.75 } });

    expect(parsed.estimatedUnitCost).toBe(7.5);
    expect(parsed.costCurrency).toBe("USD");
  });

  it("rejects unsupported item cost currencies instead of treating them as USD", () => {
    expect(() => parseItemFormData(makeFormData({ estimatedUnitCost: "10.00", costCurrency: "EUR" }))).toThrow(
      "No USD conversion rate is configured for EUR."
    );
  });
});
