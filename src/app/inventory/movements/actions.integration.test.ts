import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemCategory, LifecycleStatus, MovementType, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

import { createMovementAction, voidStockMovementAction } from "./actions";

const TEST_PREFIX = "TEST-MOVEMENT-ACTION";

async function cleanupTestData() {
  const items = await prisma.item.findMany({
    where: { sku: { startsWith: TEST_PREFIX } },
    select: { id: true }
  });
  const itemIds = items.map((item) => item.id);

  if (itemIds.length > 0) {
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockLot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: "human-admin" }, { actorId: "dev-admin" }], entityType: "StockMovement" } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }

  await prisma.storageLocation.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
}

async function createMovementFixture(suffix: string, unit: Unit = Unit.EACH) {
  const location = await prisma.storageLocation.create({
    data: { code: `${TEST_PREFIX}-${suffix}-LOC`, name: `Movement action test ${suffix}` }
  });
  const item = await prisma.item.create({
    data: {
      sku: `${TEST_PREFIX}-${suffix}-ITEM`,
      description: `Movement action item ${suffix}`,
      category: ItemCategory.COMPONENT,
      unit,
      reorderPoint: 0,
      targetStock: 0,
      leadTimeDays: 0,
      lifecycleStatus: LifecycleStatus.ACTIVE,
      storageLocationId: location.id
    }
  });
  const lot = await prisma.stockLot.create({
    data: {
      itemId: item.id,
      lotCode: `${TEST_PREFIX}-${suffix}-LOT`,
      receivedAt: new Date("2026-06-01T00:00:00.000Z"),
      unitCost: 1.23
    }
  });
  return { item, lot };
}

function movementForm(overrides: Record<string, string>) {
  const formData = new FormData();
  const values = {
    itemId: "",
    stockLotId: "",
    movementType: MovementType.RECEIVE,
    quantity: "1",
    reason: "Movement action contract test",
    reference: "PO-MOVEMENT-ACTION",
    ...overrides
  };

  for (const [key, value] of Object.entries(values)) {
    formData.set(key, value);
  }

  return formData;
}

describe("inventory movement server-action contract", () => {
  beforeEach(cleanupTestData);
  afterAll(cleanupTestData);

  it("records item-level movement rows and safely ignores stale hidden lot fields", async () => {
    const { item, lot } = await createMovementFixture("ITEM-CONTRACT");

    const state = await createMovementAction(undefined, movementForm({
      itemId: item.id,
      stockLotId: lot.id,
      quantity: "6",
      reason: ""
    }));

    expect(state).toMatchObject({ success: true });
    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { itemId: item.id },
      orderBy: { createdAt: "desc" }
    });
    expect(movement).toMatchObject({
      itemId: item.id,
      stockLotId: null,
      movementType: MovementType.RECEIVE,
      reference: "PO-MOVEMENT-ACTION"
    });
    expect(Number(movement.quantity)).toBe(6);
    expect(movement.reason).toMatch(/without an optional reason/i);
  });

  it("accepts decimal movements for meter-measured stock and persists the decimal ledger quantity", async () => {
    const { item } = await createMovementFixture("METER-DECIMAL", Unit.METER);

    const state = await createMovementAction(undefined, movementForm({
      itemId: item.id,
      quantity: "1.5",
      reason: "Meter-measured LED strip receipt",
      reference: "PO-METER-DECIMAL"
    }));

    expect(state).toMatchObject({ success: true });
    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { itemId: item.id } });
    expect(Number(movement.quantity)).toBe(1.5);
  });

  it("rejects decimal movements for piece-measured stock", async () => {
    const { item } = await createMovementFixture("EACH-DECIMAL", Unit.EACH);

    const state = await createMovementAction(undefined, movementForm({
      itemId: item.id,
      quantity: "1.5",
      reference: "PO-EACH-DECIMAL"
    }));

    expect(state).toMatchObject({
      success: false,
      domainErrorCode: "STOCK_MOVEMENT_REJECTED"
    });
    expect(state.message).toMatch(/whole number/i);
    await expect(prisma.stockMovement.count({ where: { itemId: item.id } })).resolves.toBe(0);
  });

  it("rejects item-level negative deductions before mutating the ledger and returns inline action state", async () => {
    const { item } = await createMovementFixture("NEGATIVE");

    const state = await createMovementAction(undefined, movementForm({
      itemId: item.id,
      movementType: MovementType.CONSUME,
      quantity: "1",
      reason: ""
    }));

    expect(state).toMatchObject({
      success: false,
      domainErrorCode: "NEGATIVE_STOCK"
    });
    expect(state.message).toMatch(/negative item-level stock/i);

    await expect(prisma.stockMovement.count({ where: { itemId: item.id } })).resolves.toBe(0);
  });

  it("does not create inline lots from stale lot form fields while receiving stock", async () => {
    const { item } = await createMovementFixture("NO-NEW-LOT");
    const form = movementForm({
      itemId: item.id,
      stockLotId: "__new__",
      quantity: "8",
      reason: "Received without operational lot UI",
      reference: "PO-NEW-LOT",
      newLotCode: `${TEST_PREFIX}-NEW-LOT-INLINE`,
      newLotReceivedAt: "2026-06-02",
      newLotUnitCost: "2.34",
      newLotCurrency: "CAD"
    });

    const state = await createMovementAction(undefined, form);

    expect(state).toMatchObject({ success: true });
    await expect(prisma.stockLot.findFirst({
      where: { itemId: item.id, lotCode: `${TEST_PREFIX}-NEW-LOT-INLINE` }
    })).resolves.toBeNull();
    await expect(prisma.stockMovement.count({ where: { itemId: item.id, stockLotId: null } })).resolves.toBe(1);
  });

  it("voids a stock movement by writing a compensating reversal instead of hard-deleting history", async () => {
    const { item } = await createMovementFixture("VOID");
    await createMovementAction(undefined, movementForm({ itemId: item.id, quantity: "5", reference: "PO-VOID" }));
    const original = await prisma.stockMovement.findFirstOrThrow({ where: { itemId: item.id, reference: "PO-VOID" } });

    const formData = new FormData();
    formData.set("movementId", original.id);
    await voidStockMovementAction(formData);

    const movements = await prisma.stockMovement.findMany({ where: { itemId: item.id }, orderBy: { createdAt: "asc" } });
    expect(movements).toHaveLength(2);
    expect(movements[0].id).toBe(original.id);
    expect(movements[1]).toMatchObject({
      itemId: item.id,
      movementType: MovementType.CONSUME,
      reference: `VOID:${original.id}`
    });
    expect(Number(movements[1].quantity)).toBe(5);
    await expect(prisma.auditLog.count({ where: { action: "VOID_STOCK_MOVEMENT", entityType: "StockMovement", entityId: original.id } })).resolves.toBe(1);
  });
});
