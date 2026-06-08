import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ItemCategory, LifecycleStatus, MovementType, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { visibleStockMovementWhere } from "./data";

const TEST_PREFIX = "TEST-MOVEMENT-DATA";

async function cleanupTestData() {
  const items = await prisma.item.findMany({
    where: { sku: { startsWith: TEST_PREFIX } },
    select: { id: true }
  });
  const itemIds = items.map((item) => item.id);

  if (itemIds.length > 0) {
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockLot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: TEST_PREFIX } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }

  await prisma.storageLocation.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
}

async function createItem(suffix: string) {
  const location = await prisma.storageLocation.create({
    data: { code: `${TEST_PREFIX}-${suffix}-LOC`, name: `Movement data test ${suffix}` }
  });
  return prisma.item.create({
    data: {
      sku: `${TEST_PREFIX}-${suffix}-ITEM`,
      description: `Movement data item ${suffix}`,
      category: ItemCategory.COMPONENT,
      unit: Unit.EACH,
      reorderPoint: 0,
      targetStock: 0,
      leadTimeDays: 0,
      lifecycleStatus: LifecycleStatus.ACTIVE,
      storageLocationId: location.id
    }
  });
}

describe("inventory movement page data", () => {
  beforeEach(cleanupTestData);
  afterAll(cleanupTestData);

  it("keeps normal null-reference movements visible while hiding voided originals and VOID reversal rows", async () => {
    const item = await createItem("VISIBLE-FILTER");
    const voidedOriginal = await prisma.stockMovement.create({
      data: {
        itemId: item.id,
        movementType: MovementType.RECEIVE,
        quantity: 3,
        reason: "Original movement hidden after delete",
        reference: "OPERATOR-ROW",
        actorType: "USER",
        actorId: `${TEST_PREFIX}-operator`
      }
    });
    const nullReference = await prisma.stockMovement.create({
      data: {
        itemId: item.id,
        movementType: MovementType.RECEIVE,
        quantity: 4,
        reason: "Legitimate movement without reference",
        reference: null,
        actorType: "USER",
        actorId: `${TEST_PREFIX}-operator`
      }
    });
    const normalReference = await prisma.stockMovement.create({
      data: {
        itemId: item.id,
        movementType: MovementType.RECEIVE,
        quantity: 5,
        reason: "Legitimate movement with reference",
        reference: "PO-VISIBLE",
        actorType: "USER",
        actorId: `${TEST_PREFIX}-operator`
      }
    });
    const reversal = await prisma.stockMovement.create({
      data: {
        itemId: item.id,
        movementType: MovementType.CONSUME,
        quantity: 3,
        reason: "Compensating reversal hidden from operator list",
        reference: `VOID:${voidedOriginal.id}`,
        actorType: "USER",
        actorId: `${TEST_PREFIX}-operator`
      }
    });

    const visible = await prisma.stockMovement.findMany({
      where: { AND: [{ itemId: item.id }, visibleStockMovementWhere([voidedOriginal.id])] },
      orderBy: { createdAt: "asc" }
    });
    const visibleIds = visible.map((movement) => movement.id);

    expect(visibleIds).toContain(nullReference.id);
    expect(visibleIds).toContain(normalReference.id);
    expect(visibleIds).not.toContain(voidedOriginal.id);
    expect(visibleIds).not.toContain(reversal.id);
  });
});
