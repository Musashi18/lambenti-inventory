import { describe, expect, it } from "vitest";
import { MovementType } from "@prisma/client";
import {
  calculateStockPosition,
  validateStockMovementInput
} from "./ledger";

const baseMovement = {
  itemId: "item-1",
  quantity: 1,
  reason: "Count correction after physical audit",
  actorId: "human-admin"
};

describe("calculateStockPosition", () => {
  it("derives on-hand and available stock from immutable movements", () => {
    const position = calculateStockPosition([
      { movementType: MovementType.RECEIVE, quantity: 10 },
      { movementType: MovementType.CONSUME, quantity: 3 },
      { movementType: MovementType.SCRAP, quantity: 1 },
      { movementType: MovementType.RESERVE, quantity: 2 },
      { movementType: MovementType.RETURN, quantity: 1 },
      { movementType: MovementType.ADJUST, quantity: -1 }
    ]);

    expect(position).toEqual({
      onHand: 6,
      reserved: 2,
      available: 4
    });
  });
});

describe("validateStockMovementInput", () => {
  it("rejects outbound movements that would make available stock negative", () => {
    expect(() =>
      validateStockMovementInput(
        { ...baseMovement, movementType: MovementType.CONSUME, quantity: 6 },
        { onHand: 5, reserved: 0, available: 5 }
      )
    ).toThrow(/negative available stock/i);
  });

  it("requires receive movements to have a traceable lot or reference", () => {
    expect(() =>
      validateStockMovementInput(
        { ...baseMovement, movementType: MovementType.RECEIVE, quantity: 10, reason: "Initial receipt" },
        { onHand: 0, reserved: 0, available: 0 }
      )
    ).toThrow(/lot or reference/i);
  });

  it("requires reserve movements to have a build or reservation reference", () => {
    expect(() =>
      validateStockMovementInput(
        { ...baseMovement, movementType: MovementType.RESERVE, quantity: 2, reference: "cycle-count" },
        { onHand: 5, reserved: 0, available: 5 }
      )
    ).toThrow(/build or reservation/i);
  });

  it("requires adjustment movements to include an explicit audit reference", () => {
    expect(() =>
      validateStockMovementInput(
        { ...baseMovement, movementType: MovementType.ADJUST, quantity: -1 },
        { onHand: 5, reserved: 0, available: 5 }
      )
    ).toThrow(/audit reference/i);
  });

  it("allows a traceable receive movement", () => {
    expect(() =>
      validateStockMovementInput(
        {
          ...baseMovement,
          movementType: MovementType.RECEIVE,
          quantity: 10,
          stockLotId: "lot-1",
          reference: "PO-1001"
        },
        { onHand: 0, reserved: 0, available: 0 }
      )
    ).not.toThrow();
  });
});
