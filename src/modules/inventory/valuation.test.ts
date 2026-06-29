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
        costSourceRefs: [],
        value: 17.5
      },
      {
        itemId: "priced-psu",
        sku: "PSU-12V-GS-UL",
        description: "Power adapter",
        quantity: 0,
        unitCost: 3,
        currency: "USD",
        costSourceRefs: [],
        value: 0
      }
    ]);
    expect(valuation.totalValue).toBe(17.5);
  });

  it("keeps priced valuation anchored to resolved item cost instead of stale receipt-lot costs", () => {
    const valuation = calculatePricedItemValuations([
      {
        itemId: "priced-clip",
        sku: "0805_CLIP",
        description: "0805 cable clip",
        unitCost: 0.0582,
        currency: "USD",
        movements: [
          { movementType: MovementType.RECEIVE, quantity: 1000 },
          { movementType: MovementType.RECEIVE, quantity: 500 }
        ]
      }
    ]);

    expect(valuation.rows[0]).toMatchObject({
      quantity: 1500,
      unitCost: 0.0582,
      value: 87.3
    });
  });

  it("carries price-source provenance into priced valuation rows", () => {
    const valuation = calculatePricedItemValuations([
      {
        itemId: "priced-clip",
        sku: "0805_CLIP",
        description: "0805 cable clip",
        unitCost: 0.0582,
        currency: "USD",
        costSource: "ACCOUNTING_LANDED_COST",
        costSourceLabel: "Accounting landed cost · 2500 units",
        costSourceRefs: ["WINNIE-XU-304716450001023166"],
        movements: [{ movementType: MovementType.RECEIVE, quantity: 2500 }]
      }
    ]);

    expect(valuation.rows[0]).toMatchObject({
      quantity: 2500,
      unitCost: 0.0582,
      costSource: "ACCOUNTING_LANDED_COST",
      costSourceLabel: "Accounting landed cost · 2500 units",
      costSourceRefs: ["WINNIE-XU-304716450001023166"],
      value: 145.5
    });
  });

  it("rounds ledger quantity to the common two-decimal display resolution", () => {
    const valuation = calculatePricedItemValuations([
      {
        itemId: "fractional-led",
        sku: "LED-FRACTIONAL",
        description: "Fractional LED strip",
        unitCost: 1,
        currency: "USD",
        movements: [{ movementType: MovementType.RECEIVE, quantity: 8685.630000000001 }]
      }
    ]);

    expect(valuation.rows[0].quantity).toBe(8685.63);
    expect(valuation.rows[0].value).toBe(8685.63);
  });

  it("uses the stored 4-decimal unit price for valuation while currency value remains cents-rounded", () => {
    const valuation = calculatePricedItemValuations([
      {
        itemId: "priced-high-resolution-led",
        sku: "LED-HIGH-RES",
        description: "High-resolution priced LED strip",
        unitCost: 1.2345,
        currency: "USD",
        movements: [{ movementType: MovementType.RECEIVE, quantity: 3 }]
      }
    ]);

    expect(valuation.rows[0]).toMatchObject({
      quantity: 3,
      unitCost: 1.2345,
      value: 3.7
    });
    expect(valuation.totalValue).toBe(3.7);
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
        costSourceRefs: [],
        value: 22.5
      }
    ]);
    expect(valuation.totalValue).toBe(22.5);
  });

  it("sorts priced valuation rows by the shared item use-group ordering before SKU", () => {
    const valuation = calculatePricedItemValuations([
      {
        itemId: "priced-led",
        sku: "LED-COB-12V",
        description: "Warm LED strip",
        category: "COMPONENT",
        unitCost: 1,
        currency: "USD",
        movements: []
      },
      {
        itemId: "priced-finished",
        sku: "LAMBENTI-BASIC",
        description: "Finished Lambenti build",
        category: "FINISHED_GOOD",
        unitCost: 20,
        currency: "USD",
        movements: []
      },
      {
        itemId: "priced-enclosure",
        sku: "ENC-SHELL",
        description: "Outer enclosure shell",
        category: "RAW_MATERIAL",
        unitCost: 4,
        currency: "USD",
        movements: []
      }
    ]);

    expect(valuation.rows.map((row) => row.sku)).toEqual([
      "LAMBENTI-BASIC",
      "ENC-SHELL",
      "LED-COB-12V"
    ]);
  });
});
