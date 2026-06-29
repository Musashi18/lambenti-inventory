import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CostConfidence, ItemCategory, LifecycleStatus, MovementType, PurchaseOrderStatus, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { archiveItem, getItems, unarchiveItem, updateItem, updateItemUseGroupOverride } from "./service";

const TEST_PREFIX = "TEST-ITEM-ARCHIVE";

async function cleanup() {
  const items = await prisma.item.findMany({ where: { sku: { startsWith: TEST_PREFIX } }, select: { id: true } });
  const itemIds = items.map((item) => item.id);
  if (itemIds.length > 0) {
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockLot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.purchaseOrderLine.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }
  await prisma.purchaseOrder.deleteMany({ where: { supplier: { name: { startsWith: TEST_PREFIX } } } });
  await prisma.supplier.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
  await prisma.storageLocation.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: TEST_PREFIX } } });
}

async function createItem(suffix: string, lifecycleStatus: LifecycleStatus = LifecycleStatus.ACTIVE) {
  const location = await prisma.storageLocation.create({ data: { code: `${TEST_PREFIX}-${suffix}-LOC`, name: `${TEST_PREFIX} ${suffix}` } });
  return prisma.item.create({
    data: {
      sku: `${TEST_PREFIX}-${suffix}`,
      description: `${TEST_PREFIX} ${suffix}`,
      category: ItemCategory.COMPONENT,
      unit: Unit.EACH,
      reorderPoint: 0,
      targetStock: 0,
      leadTimeDays: 1,
      lifecycleStatus,
      storageLocationId: location.id
    }
  });
}

describe("item archive visibility", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it("keeps obsolete items out of the active list while exposing them in the archived list", async () => {
    const active = await createItem("ACTIVE");
    const archived = await createItem("ARCHIVED", LifecycleStatus.OBSOLETE);

    const activeList = await getItems();
    const archivedList = await getItems({ archivedOnly: true });

    expect(activeList.some((item) => item.id === active.id)).toBe(true);
    expect(activeList.some((item) => item.id === archived.id)).toBe(false);
    expect(archivedList.some((item) => item.id === archived.id)).toBe(true);
    expect(archivedList.some((item) => item.id === active.id)).toBe(false);
  });

  it("archives and unarchives without deleting the item", async () => {
    const item = await createItem("ROUNDTRIP");

    await archiveItem({ id: item.id, actorId: `${TEST_PREFIX}-operator` });
    await expect(prisma.item.findUniqueOrThrow({ where: { id: item.id } })).resolves.toMatchObject({ lifecycleStatus: LifecycleStatus.OBSOLETE });

    await unarchiveItem({ id: item.id, actorId: `${TEST_PREFIX}-operator` });
    await expect(prisma.item.findUniqueOrThrow({ where: { id: item.id } })).resolves.toMatchObject({ lifecycleStatus: LifecycleStatus.ACTIVE });
  });

  it("persists manual catalog section overrides without changing the coarse item category", async () => {
    const item = await createItem("USE-GROUP");

    await updateItemUseGroupOverride({ id: item.id, useGroupOverride: "magnetic-hardware", actorId: `${TEST_PREFIX}-operator` });
    await expect(prisma.item.findUniqueOrThrow({ where: { id: item.id } })).resolves.toMatchObject({
      category: ItemCategory.COMPONENT,
      useGroupOverride: "magnetic-hardware"
    });

    await updateItemUseGroupOverride({ id: item.id, useGroupOverride: "", actorId: `${TEST_PREFIX}-operator` });
    await expect(prisma.item.findUniqueOrThrow({ where: { id: item.id } })).resolves.toMatchObject({ useGroupOverride: null });
  });

  it("syncs a manual item price edit only into the most recent PO receipt lot", async () => {
    const item = await createItem("RECENT-LOT-COST");
    const supplier = await prisma.supplier.create({
      data: {
        name: `${TEST_PREFIX} Supplier recent lot cost`,
        moq: 1,
        leadTimeDays: 1,
        shippingCost: 0,
        reliabilityScore: 0.9
      }
    });
    const order = await prisma.purchaseOrder.create({
      data: {
        supplierId: supplier.id,
        status: PurchaseOrderStatus.PARTIALLY_RECEIVED,
        lines: {
          create: [
            { itemId: item.id, quantity: 100, unitPrice: 0.04, receivedQuantity: 100 },
            { itemId: item.id, quantity: 50, unitPrice: 0.02, receivedQuantity: 50 }
          ]
        }
      },
      include: { lines: { orderBy: { quantity: "desc" } } }
    });
    const oldLot = await prisma.stockLot.create({ data: { itemId: item.id, lotCode: `${TEST_PREFIX}-OLD`, receivedAt: new Date("2026-06-01T00:00:00.000Z"), unitCost: 0.04 } });
    const recentLot = await prisma.stockLot.create({ data: { itemId: item.id, lotCode: `${TEST_PREFIX}-RECENT`, receivedAt: new Date("2026-06-02T00:00:00.000Z"), unitCost: 0.03 } });
    await prisma.stockMovement.create({
      data: {
        itemId: item.id,
        stockLotId: oldLot.id,
        purchaseOrderLineId: order.lines[0].id,
        movementType: MovementType.RECEIVE,
        quantity: 100,
        reason: "Old receipt",
        reference: "PO-OLD",
        actorType: "USER",
        actorId: `${TEST_PREFIX}-setup`,
        createdAt: new Date("2026-06-01T12:00:00.000Z")
      }
    });
    await prisma.stockMovement.create({
      data: {
        itemId: item.id,
        stockLotId: recentLot.id,
        purchaseOrderLineId: order.lines[1].id,
        movementType: MovementType.RECEIVE,
        quantity: 50,
        reason: "Recent receipt",
        reference: "PO-RECENT",
        actorType: "USER",
        actorId: `${TEST_PREFIX}-setup`,
        createdAt: new Date("2026-06-02T12:00:00.000Z")
      }
    });

    await updateItem({
      id: item.id,
      sku: item.sku,
      description: item.description,
      category: item.category,
      unit: item.unit,
      reorderPoint: item.reorderPoint,
      targetStock: item.targetStock,
      leadTimeDays: item.leadTimeDays,
      lifecycleStatus: item.lifecycleStatus,
      estimatedUnitCost: 0.02,
      costCurrency: "USD",
      costConfidence: CostConfidence.CONFIRMED,
      costSourceRef: "manual correction after receipt",
      actorId: `${TEST_PREFIX}-operator-recent-lot-cost`
    });

    const [oldAfter, recentAfter] = await Promise.all([
      prisma.stockLot.findUniqueOrThrow({ where: { id: oldLot.id } }),
      prisma.stockLot.findUniqueOrThrow({ where: { id: recentLot.id } })
    ]);
    expect(Number(oldAfter.unitCost)).toBe(0.04);
    expect(Number(recentAfter.unitCost)).toBe(0.02);
    await expect(prisma.auditLog.count({ where: { action: "UPDATE_RECENT_RECEIPT_LOT_COST_FROM_ITEM_PRICE", entityId: recentLot.id } })).resolves.toBe(1);
  });
});
