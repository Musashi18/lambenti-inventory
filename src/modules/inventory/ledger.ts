import { MovementType } from "@prisma/client";

export type StockPosition = {
  onHand: number;
  reserved: number;
  available: number;
};

export type LedgerMovement = {
  movementType: MovementType;
  quantity: number | { toNumber(): number };
};

export type StockMovementInput = {
  itemId: string;
  stockLotId?: string;
  movementType: MovementType;
  quantity: number;
  reason?: string;
  reference?: string;
  actorId: string;
};

export function calculateStockPosition(movements: LedgerMovement[]): StockPosition {
  const onHand = movements.reduce((total, movement) => {
    const quantity = movementQuantity(movement.quantity);
    switch (movement.movementType) {
      case MovementType.RECEIVE:
      case MovementType.RETURN:
        return roundQuantity(total + quantity);
      case MovementType.CONSUME:
      case MovementType.SCRAP:
        return roundQuantity(total - quantity);
      case MovementType.ADJUST:
        return roundQuantity(total + quantity);
      case MovementType.RESERVE:
        return total;
      default:
        return total;
    }
  }, 0);

  const reserved = movements
    .filter((movement) => movement.movementType === MovementType.RESERVE)
    .reduce((total, movement) => roundQuantity(total + movementQuantity(movement.quantity)), 0);

  return {
    onHand,
    reserved,
    available: roundQuantity(onHand - reserved)
  };
}

export function validateStockMovementInput(input: StockMovementInput, current: StockPosition): void {
  if (input.movementType !== MovementType.ADJUST && input.quantity <= 0) {
    throw new Error("Quantity must be positive except for adjustments.");
  }

  if (input.movementType === MovementType.RECEIVE && !input.stockLotId && !hasReference(input)) {
    throw new Error("Receive movements require a lot or reference.");
  }

  if (input.movementType === MovementType.RESERVE && !hasBuildOrReservationReference(input)) {
    throw new Error("Reserve movements require a build or reservation reference.");
  }

  if (input.movementType === MovementType.ADJUST && !hasReference(input)) {
    throw new Error("Adjustment movements require an explicit audit reference.");
  }

  const projected = projectMovement(current, input);
  if (projected.available < 0) {
    throw new Error("Stock movement would create negative available stock.");
  }

  if (projected.onHand < 0) {
    throw new Error("Stock movement would create negative on-hand stock.");
  }
}

function projectMovement(current: StockPosition, movement: LedgerMovement): StockPosition {
  return calculateStockPosition([
    { movementType: MovementType.ADJUST, quantity: current.onHand },
    { movementType: MovementType.RESERVE, quantity: current.reserved },
    movement
  ]);
}

function movementQuantity(quantity: LedgerMovement["quantity"]) {
  return typeof quantity === "number" ? quantity : quantity.toNumber();
}

function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function hasReference(input: StockMovementInput) {
  return Boolean(input.reference?.trim());
}

function hasBuildOrReservationReference(input: StockMovementInput) {
  const reference = input.reference?.trim().toLowerCase() ?? "";
  return reference.startsWith("build-") || reference.startsWith("reservation-") || reference.startsWith("kit-");
}
