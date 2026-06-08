import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ItemCategory, LifecycleStatus, MovementType, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createStockMovement, createStockMovementReversal, getStockSummaries, recordAssembledPackageMovement } from "./service";
import { calculateStockPosition } from "./ledger";

const TEST_PREFIX = "TEST-STOCK-SERVICE";

async function cleanupTestData() {
  const items = await prisma.item.findMany({
    where: { sku: { startsWith: TEST_PREFIX } },
    select: { id: true }
  });
  const itemIds = items.map((item) => item.id);

  if (itemIds.length > 0) {
    const boms = await prisma.bOM.findMany({
      where: { OR: [{ parentItemId: { in: itemIds } }, { lines: { some: { componentItemId: { in: itemIds } } } }] },
      select: { id: true }
    });
    const bomIds = boms.map((bom) => bom.id);
    if (bomIds.length > 0) await prisma.bOMLine.deleteMany({ where: { bomId: { in: bomIds } } });
    if (bomIds.length > 0) await prisma.bOM.deleteMany({ where: { id: { in: bomIds } } });
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockLot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: TEST_PREFIX } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }

  await prisma.storageLocation.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
}

async function createInventoryFixture(suffix: string) {
  const location = await prisma.storageLocation.create({
    data: {
      code: `${TEST_PREFIX}-${suffix}-LOC`,
      name: `Test location ${suffix}`
    }
  });

  const item = await prisma.item.create({
    data: {
      sku: `${TEST_PREFIX}-${suffix}-ITEM`,
      description: `Test item ${suffix}`,
      category: ItemCategory.COMPONENT,
      unit: Unit.EACH,
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
      lotCode: `${TEST_PREFIX}-${suffix}-LOT-A`,
      receivedAt: new Date("2026-06-01T00:00:00.000Z"),
      unitCost: 1.23
    }
  });

  return { item, location, lot };
}

describe("createStockMovement integration", () => {
  beforeEach(cleanupTestData);
  afterAll(cleanupTestData);

  it("persists a valid stock movement, updates derived stock, and writes one audit log", async () => {
    const { item, lot } = await createInventoryFixture("RECEIVE");

    const movement = await createStockMovement({
      itemId: item.id,
      stockLotId: lot.id,
      movementType: MovementType.RECEIVE,
      quantity: 5,
      reason: "Received against test purchase order",
      reference: "PO-TEST-RECEIVE",
      actorId: `${TEST_PREFIX}-actor-receive`
    });

    expect(movement).toMatchObject({
      itemId: item.id,
      stockLotId: lot.id,
      movementType: MovementType.RECEIVE,
      quantity: 5
    });

    const summary = (await getStockSummaries()).find((row) => row.itemId === item.id);
    expect(summary).toMatchObject({ onHand: 5, reserved: 0, available: 5 });

    const auditCount = await prisma.auditLog.count({
      where: { actorId: `${TEST_PREFIX}-actor-receive`, action: "CREATE_STOCK_MOVEMENT" }
    });
    expect(auditCount).toBe(1);
  });

  it("rejects operator-created movements that try to spoof the reserved VOID reversal reference prefix", async () => {
    const { item, lot } = await createInventoryFixture("VOID-SPOOF");

    await expect(createStockMovement({
      itemId: item.id,
      stockLotId: lot.id,
      movementType: MovementType.RECEIVE,
      quantity: 1,
      reason: "Attempt to spoof a void reversal row",
      reference: "VOID:some-other-movement",
      actorId: `${TEST_PREFIX}-actor-void-spoof`
    })).rejects.toThrow(/reserved/i);

    await expect(prisma.stockMovement.count({ where: { itemId: item.id } })).resolves.toBe(0);
    await expect(prisma.auditLog.count({ where: { actorId: `${TEST_PREFIX}-actor-void-spoof` } })).resolves.toBe(0);
  });

  it("still writes audited VOID reversal references from the trusted reversal path", async () => {
    const { item, lot } = await createInventoryFixture("VOID-TRUSTED");
    const original = await createStockMovement({
      itemId: item.id,
      stockLotId: lot.id,
      movementType: MovementType.RECEIVE,
      quantity: 2,
      reason: "Received stock to reverse through the trusted path",
      reference: "PO-TRUSTED-VOID",
      actorId: `${TEST_PREFIX}-actor-trusted-void-setup`
    });

    await createStockMovementReversal({
      movementId: original.id,
      actorId: `${TEST_PREFIX}-actor-trusted-void`
    });

    const reversal = await prisma.stockMovement.findFirstOrThrow({
      where: { itemId: item.id, reference: `VOID:${original.id}` }
    });
    expect(reversal).toMatchObject({
      stockLotId: lot.id,
      movementType: MovementType.CONSUME,
      quantity: 2
    });
    await expect(prisma.auditLog.count({
      where: { action: "VOID_STOCK_MOVEMENT", entityType: "StockMovement", entityId: original.id }
    })).resolves.toBe(1);
  });

  it("rejects item-level negative stock and leaves no movement or audit trail", async () => {
    const { item } = await createInventoryFixture("NEGATIVE-ITEM");

    await expect(createStockMovement({
      itemId: item.id,
      movementType: MovementType.CONSUME,
      quantity: 1,
      reason: "Consume without available inventory",
      actorId: `${TEST_PREFIX}-actor-negative-item`
    })).rejects.toThrow(/negative/i);

    await expect(prisma.stockMovement.count({ where: { itemId: item.id } })).resolves.toBe(0);
    await expect(prisma.auditLog.count({ where: { actorId: `${TEST_PREFIX}-actor-negative-item` } })).resolves.toBe(0);
  });

  it("rejects lot-level negative stock even when the item has stock in another lot", async () => {
    const { item, lot: stockedLot } = await createInventoryFixture("NEGATIVE-LOT");
    const emptyLot = await prisma.stockLot.create({
      data: {
        itemId: item.id,
        lotCode: `${TEST_PREFIX}-NEGATIVE-LOT-LOT-B`,
        receivedAt: new Date("2026-06-02T00:00:00.000Z"),
        unitCost: 2.34
      }
    });

    await createStockMovement({
      itemId: item.id,
      stockLotId: stockedLot.id,
      movementType: MovementType.RECEIVE,
      quantity: 10,
      reason: "Received stock into lot A",
      reference: "PO-TEST-LOT-A",
      actorId: `${TEST_PREFIX}-actor-lot-setup`
    });

    await expect(createStockMovement({
      itemId: item.id,
      stockLotId: emptyLot.id,
      movementType: MovementType.CONSUME,
      quantity: 1,
      reason: "Attempt consume from empty lot B",
      actorId: `${TEST_PREFIX}-actor-negative-lot`
    })).rejects.toThrow(/lot/i);

    const emptyLotPosition = calculateStockPosition(await prisma.stockMovement.findMany({
      where: { stockLotId: emptyLot.id },
      select: { movementType: true, quantity: true }
    }));
    expect(emptyLotPosition).toEqual({ onHand: 0, reserved: 0, available: 0 });
  });

  it("rejects stockLotId values that belong to a different item", async () => {
    const { item: firstItem, lot: firstLot } = await createInventoryFixture("LOT-OWNER-A");
    const { item: secondItem } = await createInventoryFixture("LOT-OWNER-B");

    await expect(createStockMovement({
      itemId: secondItem.id,
      stockLotId: firstLot.id,
      movementType: MovementType.RECEIVE,
      quantity: 3,
      reason: "Receive into another item lot",
      reference: "PO-TEST-LOT-MISMATCH",
      actorId: `${TEST_PREFIX}-actor-lot-mismatch`
    })).rejects.toThrow(/lot.*item/i);

    await expect(prisma.stockMovement.count({ where: { itemId: secondItem.id } })).resolves.toBe(0);
    await expect(prisma.stockMovement.count({ where: { itemId: firstItem.id } })).resolves.toBe(0);
  });

  it("serializes concurrent deductions so stock cannot be overdrawn", async () => {
    const { item, lot } = await createInventoryFixture("CONCURRENT");

    await createStockMovement({
      itemId: item.id,
      stockLotId: lot.id,
      movementType: MovementType.RECEIVE,
      quantity: 5,
      reason: "Received stock for concurrency test",
      reference: "PO-TEST-CONCURRENT",
      actorId: `${TEST_PREFIX}-actor-concurrency-setup`
    });

    const attempts = await Promise.allSettled([
      createStockMovement({
        itemId: item.id,
        stockLotId: lot.id,
        movementType: MovementType.CONSUME,
        quantity: 4,
        reason: "Concurrent deduction one",
        actorId: `${TEST_PREFIX}-actor-concurrency-1`
      }),
      createStockMovement({
        itemId: item.id,
        stockLotId: lot.id,
        movementType: MovementType.CONSUME,
        quantity: 4,
        reason: "Concurrent deduction two",
        actorId: `${TEST_PREFIX}-actor-concurrency-2`
      })
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);

    const position = calculateStockPosition(await prisma.stockMovement.findMany({
      where: { itemId: item.id },
      select: { movementType: true, quantity: true }
    }));
    expect(position).toEqual({ onHand: 1, reserved: 0, available: 1 });
  });

  it("records assembled package builds as one finished-good receipt plus BOM component consumption movements", async () => {
    const location = await prisma.storageLocation.create({ data: { code: `${TEST_PREFIX}-ASSEMBLY-LOC`, name: "Assembly test location" } });
    const finished = await prisma.item.create({ data: {
      sku: `${TEST_PREFIX}-ASSEMBLY-FINISHED`,
      description: "Finished assembled package",
      category: ItemCategory.FINISHED_GOOD,
      unit: Unit.EACH,
      reorderPoint: 0,
      targetStock: 0,
      leadTimeDays: 0,
      lifecycleStatus: LifecycleStatus.ACTIVE,
      storageLocationId: location.id
    } });
    const componentA = await prisma.item.create({ data: {
      sku: `${TEST_PREFIX}-ASSEMBLY-COMP-A`,
      description: "Assembly component A",
      category: ItemCategory.COMPONENT,
      unit: Unit.EACH,
      reorderPoint: 0,
      targetStock: 0,
      leadTimeDays: 0,
      lifecycleStatus: LifecycleStatus.ACTIVE,
      storageLocationId: location.id
    } });
    const componentB = await prisma.item.create({ data: {
      sku: `${TEST_PREFIX}-ASSEMBLY-COMP-B`,
      description: "Assembly component B",
      category: ItemCategory.COMPONENT,
      unit: Unit.EACH,
      reorderPoint: 0,
      targetStock: 0,
      leadTimeDays: 0,
      lifecycleStatus: LifecycleStatus.ACTIVE,
      storageLocationId: location.id
    } });
    await prisma.bOM.create({ data: {
      parentItemId: finished.id,
      version: `${TEST_PREFIX}-ASSEMBLY-BOM`,
      active: true,
      lines: { create: [
        { componentItemId: componentA.id, quantity: 2 },
        { componentItemId: componentB.id, quantity: 5 }
      ] }
    } });
    await createStockMovement({ itemId: componentA.id, movementType: MovementType.RECEIVE, quantity: 9, reason: "Assembly fixture", reference: "BUILD-SETUP-A", actorId: `${TEST_PREFIX}-actor-assembly-setup` });
    await createStockMovement({ itemId: componentB.id, movementType: MovementType.RECEIVE, quantity: 21, reason: "Assembly fixture", reference: "BUILD-SETUP-B", actorId: `${TEST_PREFIX}-actor-assembly-setup` });

    const movements = await recordAssembledPackageMovement({
      finishedItemId: finished.id,
      quantity: 4,
      reason: "Built four finished packages",
      reference: "BUILD-4",
      actorId: `${TEST_PREFIX}-actor-assembly`
    });

    expect(movements).toHaveLength(3);
    const positions = await Promise.all([finished.id, componentA.id, componentB.id].map(async (itemId) => calculateStockPosition(await prisma.stockMovement.findMany({
      where: { itemId },
      select: { movementType: true, quantity: true }
    }))));
    expect(positions).toEqual([
      { onHand: 4, reserved: 0, available: 4 },
      { onHand: 1, reserved: 0, available: 1 },
      { onHand: 1, reserved: 0, available: 1 }
    ]);
    await expect(prisma.stockMovement.count({ where: { reference: "BUILD-4" } })).resolves.toBe(3);
  });

  it("rejects assembled package builds when any BOM component line is obsolete instead of silently under-consuming", async () => {
    const location = await prisma.storageLocation.create({ data: { code: `${TEST_PREFIX}-ASSEMBLY-OBSOLETE-LOC`, name: "Assembly obsolete test location" } });
    const finished = await prisma.item.create({ data: {
      sku: `${TEST_PREFIX}-ASSEMBLY-OBSOLETE-FINISHED`,
      description: "Finished assembled package with stale BOM",
      category: ItemCategory.FINISHED_GOOD,
      unit: Unit.EACH,
      reorderPoint: 0,
      targetStock: 0,
      leadTimeDays: 0,
      lifecycleStatus: LifecycleStatus.ACTIVE,
      storageLocationId: location.id
    } });
    const activeComponent = await prisma.item.create({ data: {
      sku: `${TEST_PREFIX}-ASSEMBLY-OBSOLETE-ACTIVE`,
      description: "Assembly active component",
      category: ItemCategory.COMPONENT,
      unit: Unit.EACH,
      reorderPoint: 0,
      targetStock: 0,
      leadTimeDays: 0,
      lifecycleStatus: LifecycleStatus.ACTIVE,
      storageLocationId: location.id
    } });
    const obsoleteComponent = await prisma.item.create({ data: {
      sku: `${TEST_PREFIX}-ASSEMBLY-OBSOLETE-COMP`,
      description: "Assembly obsolete component",
      category: ItemCategory.COMPONENT,
      unit: Unit.EACH,
      reorderPoint: 0,
      targetStock: 0,
      leadTimeDays: 0,
      lifecycleStatus: LifecycleStatus.OBSOLETE,
      storageLocationId: location.id
    } });
    await prisma.bOM.create({ data: {
      parentItemId: finished.id,
      version: `${TEST_PREFIX}-ASSEMBLY-OBSOLETE-BOM`,
      active: true,
      lines: { create: [
        { componentItemId: activeComponent.id, quantity: 1 },
        { componentItemId: obsoleteComponent.id, quantity: 1 }
      ] }
    } });
    await createStockMovement({ itemId: activeComponent.id, movementType: MovementType.RECEIVE, quantity: 3, reason: "Assembly obsolete fixture", reference: "BUILD-OBSOLETE-SETUP-A", actorId: `${TEST_PREFIX}-actor-assembly-setup` });
    await createStockMovement({ itemId: obsoleteComponent.id, movementType: MovementType.RECEIVE, quantity: 3, reason: "Assembly obsolete fixture", reference: "BUILD-OBSOLETE-SETUP-B", actorId: `${TEST_PREFIX}-actor-assembly-setup` });

    await expect(recordAssembledPackageMovement({
      finishedItemId: finished.id,
      quantity: 1,
      reference: "BUILD-OBSOLETE-ATTEMPT",
      actorId: `${TEST_PREFIX}-actor-assembly`
    })).rejects.toThrow(/obsolete BOM component/i);
    await expect(prisma.stockMovement.count({ where: { reference: "BUILD-OBSOLETE-ATTEMPT" } })).resolves.toBe(0);
  });
});
