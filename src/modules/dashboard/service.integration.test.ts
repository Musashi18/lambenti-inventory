import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ItemCategory, LifecycleStatus, MovementType, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getDashboardSummary } from "./service";

const TEST_PREFIX = "TEST-DASH-STOCK";

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
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }

  await prisma.storageLocation.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
}

async function createDashboardStockFixture() {
  const location = await prisma.storageLocation.create({
    data: { code: `${TEST_PREFIX}-LOC`, name: "Dashboard stock fixture" }
  });
  const item = await prisma.item.create({
    data: {
      sku: `${TEST_PREFIX}-ITEM`,
      description: "Dashboard stock quantity fixture",
      category: ItemCategory.COMPONENT,
      unit: Unit.EACH,
      reorderPoint: 2,
      targetStock: 10,
      leadTimeDays: 3,
      lifecycleStatus: LifecycleStatus.ACTIVE,
      storageLocationId: location.id
    }
  });

  await prisma.stockMovement.createMany({
    data: [
      {
        itemId: item.id,
        movementType: MovementType.RECEIVE,
        quantity: 12,
        reason: "Dashboard stock fixture receipt",
        reference: `${TEST_PREFIX}-RECEIPT`,
        actorType: "USER",
        actorId: TEST_PREFIX
      },
      {
        itemId: item.id,
        movementType: MovementType.RESERVE,
        quantity: 4,
        reason: "Dashboard stock fixture reservation",
        reference: `${TEST_PREFIX}-RESERVATION`,
        actorType: "USER",
        actorId: TEST_PREFIX
      }
    ]
  });

  return item;
}

describe("dashboard stock quantities", () => {
  beforeEach(cleanupTestData);
  afterAll(cleanupTestData);

  it("exposes ledger-derived in-stock quantities for the main dashboard", async () => {
    const item = await createDashboardStockFixture();

    const summary = await getDashboardSummary();

    const stockItem = summary.stockItems.find((entry) => entry.itemId === item.id);
    expect(stockItem).toMatchObject({
      sku: `${TEST_PREFIX}-ITEM`,
      onHand: 12,
      reserved: 4,
      available: 8,
      reorderPoint: 2,
      targetStock: 10
    });
  });

  it("summarizes component on-hand, finished-build capacity, and assembled package count from BOM and ledger data", async () => {
    const location = await prisma.storageLocation.create({
      data: { code: `${TEST_PREFIX}-BUILD-LOC`, name: "Dashboard build fixture" }
    });
    const finished = await prisma.item.create({
      data: {
        sku: `${TEST_PREFIX}-FINISHED`,
        description: "Finished Lambenti package",
        category: ItemCategory.FINISHED_GOOD,
        unit: Unit.EACH,
        reorderPoint: 0,
        targetStock: 0,
        leadTimeDays: 0,
        lifecycleStatus: LifecycleStatus.ACTIVE,
        storageLocationId: location.id
      }
    });
    const componentA = await prisma.item.create({
      data: {
        sku: `${TEST_PREFIX}-COMP-A`,
        description: "Component A",
        category: ItemCategory.COMPONENT,
        unit: Unit.EACH,
        reorderPoint: 0,
        targetStock: 0,
        leadTimeDays: 0,
        lifecycleStatus: LifecycleStatus.ACTIVE,
        storageLocationId: location.id
      }
    });
    const componentB = await prisma.item.create({
      data: {
        sku: `${TEST_PREFIX}-COMP-B`,
        description: "Component B",
        category: ItemCategory.RAW_MATERIAL,
        unit: Unit.EACH,
        reorderPoint: 0,
        targetStock: 0,
        leadTimeDays: 0,
        lifecycleStatus: LifecycleStatus.ACTIVE,
        storageLocationId: location.id
      }
    });
    await prisma.bOM.create({
      data: {
        parentItemId: finished.id,
        version: `${TEST_PREFIX}-BOM`,
        active: true,
        lines: { create: [
          { componentItemId: componentA.id, quantity: 2 },
          { componentItemId: componentB.id, quantity: 5 }
        ] }
      }
    });
    await prisma.stockMovement.createMany({
      data: [
        { itemId: componentA.id, movementType: MovementType.RECEIVE, quantity: 12, reason: "capacity fixture", actorType: "USER", actorId: TEST_PREFIX },
        { itemId: componentB.id, movementType: MovementType.RECEIVE, quantity: 21, reason: "capacity fixture", actorType: "USER", actorId: TEST_PREFIX },
        { itemId: finished.id, movementType: MovementType.RECEIVE, quantity: 3, reason: "assembled package fixture", actorType: "USER", actorId: TEST_PREFIX }
      ]
    });

    const summary = await getDashboardSummary();

    expect(summary.componentsOnHand).toBeGreaterThanOrEqual(33);
    expect(summary.buildCapacity).toMatchObject({ finishedBuildCapacity: 4 });
    expect(summary.assembledPackages).toBeGreaterThanOrEqual(3);
  });
});
