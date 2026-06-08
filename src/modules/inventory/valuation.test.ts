import { describe, expect, it } from "vitest";
import { MovementType } from "@prisma/client";
import { calculateLotValuations, calculatePricedItemValuations } from "./valuation";

describe("calculateLotValuations", () => {
  it("values each stock lot from its own movement history instead of item-level on-hand", () => {
    const valuation = calculateLotValuations([
      {
        itemId: "item-led",
        sku: "LED-COB-12V-3000K",
        lotCode: "LOT-A",
        unitCost: 2,
        movements: [
          { movementType: MovementType.RECEIVE, quantity: 10 },
          { movementType: MovementType.CONSUME, quantity: 4 }
        ]
      },
      {
        itemId: "item-led",
        sku: "LED-COB-12V-3000K",
        lotCode: "LOT-B",
        unitCost: 3,
        movements: [
          { movementType: MovementType.RECEIVE, quantity: 5 },
          { movementType: MovementType.RESERVE, quantity: 2 }
        ]
      }
    ]);

    expect(valuation.rows).toEqual([
      {
        itemId: "item-led",
        sku: "LED-COB-12V-3000K",
        lotCode: "LOT-A",
        onHand: 6,
        reserved: 0,
        available: 6,
        unitCost: 2,
        value: 12
      },
      {
        itemId: "item-led",
        sku: "LED-COB-12V-3000K",
        lotCode: "LOT-B",
        onHand: 5,
        reserved: 2,
        available: 3,
        unitCost: 3,
        value: 15
      }
    ]);
    expect(valuation.totalValue).toBe(27);
  });
});

describe("calculatePricedItemValuations", () => {
  it("automatically values every item with a price from item ledger quantity times unit price", () => {
    const valuation = calculatePricedItemValuations([
      {
        itemId: "priced-led",
        sku: "LED-COB-12V-3000K",
        description: "Warm LED strip",
        unitCost: 2.5,
        currency: "USD",
        movements: [
          { movementType: MovementType.RECEIVE, quantity: 10 },
          { movementType: MovementType.CONSUME, quantity: 3 }
        ]
      },
      {
        itemId: "priced-psu",
        sku: "PSU-12V-GS-UL",
        description: "Power adapter",
        unitCost: 3,
        currency: "USD",
        movements: []
      },
      {
        itemId: "unpriced-cable",
        sku: "CABLE-UL2464-2C-1P5M",
        description: "Cable without cost",
        unitCost: null,
        currency: "USD",
        movements: [{ movementType: MovementType.RECEIVE, quantity: 100 }]
      }
    ]);

    expect(valuation.rows).toEqual([
      {
        itemId: "priced-led",
        sku: "LED-COB-12V-3000K",
        description: "Warm LED strip",
        quantity: 7,
        unitCost: 2.5,
        currency: "USD",
        value: 17.5
      },
      {
        itemId: "priced-psu",
        sku: "PSU-12V-GS-UL",
        description: "Power adapter",
        quantity: 0,
        unitCost: 3,
        currency: "USD",
        value: 0
      }
    ]);
    expect(valuation.totalValue).toBe(17.5);
  });

  it("normalizes CAD item costs into USD before valuing inventory", () => {
    const valuation = calculatePricedItemValuations([
      {
        itemId: "priced-cad-led",
        sku: "LED-CAD",
        description: "CAD-priced LED strip",
        unitCost: 10,
        currency: "CAD",
        movements: [{ movementType: MovementType.RECEIVE, quantity: 3 }]
      }
    ], { rates: { CAD: 0.75 } });

    expect(valuation.rows).toEqual([
      {
        itemId: "priced-cad-led",
        sku: "LED-CAD",
        description: "CAD-priced LED strip",
        quantity: 3,
        unitCost: 7.5,
        currency: "USD",
        value: 22.5
      }
    ]);
    expect(valuation.totalValue).toBe(22.5);
  });
});
