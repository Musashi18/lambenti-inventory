import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ItemCategory, LifecycleStatus, MovementType, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createStockMovement } from "@/modules/inventory/service";
import { addBomLine, consumeBomBuild, createBomSection, removeBomLine, updateBomLine } from "./service";

const TEST_PREFIX = "TEST-BOM-EDIT";

async function cleanup() {
  const items = await prisma.item.findMany({ where: { sku: { startsWith: TEST_PREFIX } }, select: { id: true } });
  const itemIds = items.map((item) => item.id);
  const boms = await prisma.bOM.findMany({ where: { parentItemId: { in: itemIds } }, select: { id: true } });
  const bomIds = boms.map((bom) => bom.id);

  if (itemIds.length > 0) await prisma.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
  if (bomIds.length > 0) await prisma.bOMLine.deleteMany({ where: { bomId: { in: bomIds } } });
  if (bomIds.length > 0) await prisma.bOM.deleteMany({ where: { id: { in: bomIds } } });
  if (itemIds.length > 0) await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  await prisma.storageLocation.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: TEST_PREFIX } } });
}

async function createItem(suffix: string, category: ItemCategory = ItemCategory.COMPONENT, unit: Unit = Unit.EACH) {
  const location = await prisma.storageLocation.create({ data: { code: `${TEST_PREFIX}-${suffix}-LOC`, name: `${TEST_PREFIX} ${suffix}` } });
  return prisma.item.create({
    data: {
      sku: `${TEST_PREFIX}-${suffix}`,
      description: `${TEST_PREFIX} ${suffix}`,
      category,
      unit,
      reorderPoint: 0,
      targetStock: 0,
      leadTimeDays: 1,
      lifecycleStatus: LifecycleStatus.ACTIVE,
      storageLocationId: location.id,
      estimatedUnitCost: 1,
      costCurrency: "USD"
    }
  });
}

describe("editable BOM quantities and explicit build consumption", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it("updates quantity per unit and consumes components using edited quantities", async () => {
    const parent = await createItem("PARENT");
    const component = await createItem("COMPONENT");
    const bom = await prisma.bOM.create({
      data: {
        parentItemId: parent.id,
        version: `${TEST_PREFIX}-V1`,
        lines: { create: [{ componentItemId: component.id, quantity: 2 }] }
      },
      include: { lines: true }
    });

    await createStockMovement({
      itemId: component.id,
      movementType: MovementType.RECEIVE,
      quantity: 20,
      reason: "BOM test receipt",
      reference: `${TEST_PREFIX}-RECEIPT`,
      actorId: `${TEST_PREFIX}-operator`
    });

    await updateBomLine({ lineId: bom.lines[0].id, componentItemId: component.id, quantity: 3, actorId: `${TEST_PREFIX}-operator` });
    const result = await consumeBomBuild({ bomId: bom.id, buildQuantity: 4, reference: `${TEST_PREFIX}-BUILD`, actorId: `${TEST_PREFIX}-operator` });

    expect(result.movements).toHaveLength(1);
    expect(result.movements[0]).toMatchObject({
      itemId: component.id,
      movementType: MovementType.CONSUME,
      reference: `${TEST_PREFIX}-BUILD`
    });
    expect(Number(result.movements[0].quantity)).toBe(12);

    const savedLine = await prisma.bOMLine.findUniqueOrThrow({ where: { id: bom.lines[0].id } });
    expect(Number(savedLine.quantity)).toBe(3);
    await expect(prisma.auditLog.count({ where: { actorId: `${TEST_PREFIX}-operator`, action: { in: ["UPDATE_BOM_LINE_QUANTITY", "CONSUME_BOM_BUILD"] } } })).resolves.toBe(2);
  });

  it("allows decimal quantity per unit for meter-based LED strip BOM lines", async () => {
    const parent = await createItem("LED-PARENT", ItemCategory.FINISHED_GOOD);
    const ledStrip = await createItem("LED-STRIP", ItemCategory.COMPONENT, Unit.METER);
    const bom = await createBomSection({ parentItemId: parent.id, actorId: `${TEST_PREFIX}-operator` });
    const line = await addBomLine({ bomId: bom.id, componentItemId: ledStrip.id, quantity: 0.5, actorId: `${TEST_PREFIX}-operator` });

    expect(Number(line.quantity)).toBe(0.5);

    await createStockMovement({
      itemId: ledStrip.id,
      movementType: MovementType.RECEIVE,
      quantity: 5,
      reason: "Decimal BOM LED strip test receipt",
      reference: `${TEST_PREFIX}-LED-RECEIPT`,
      actorId: `${TEST_PREFIX}-operator`
    });

    const result = await consumeBomBuild({ bomId: bom.id, buildQuantity: 3, reference: `${TEST_PREFIX}-LED-BUILD`, actorId: `${TEST_PREFIX}-operator` });

    expect(result.movements).toHaveLength(1);
    expect(Number(result.movements[0].quantity)).toBe(1.5);
    const savedLedLine = await prisma.bOMLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(Number(savedLedLine.quantity)).toBe(0.5);
  });

  it("creates a new finished-unit section, adds a component line, updates it, and removes it", async () => {
    const parent = await createItem("NEW-PARENT", ItemCategory.FINISHED_GOOD);
    const component = await createItem("NEW-COMPONENT");
    const replacement = await createItem("NEW-REPLACEMENT");

    const bom = await createBomSection({ parentItemId: parent.id, actorId: `${TEST_PREFIX}-operator` });
    expect(bom).toMatchObject({ parentItemId: parent.id, version: "v1", active: true });

    const line = await addBomLine({ bomId: bom.id, componentItemId: component.id, quantity: 2, actorId: `${TEST_PREFIX}-operator` });
    expect(line).toMatchObject({ bomId: bom.id, componentItemId: component.id });
    expect(Number(line.quantity)).toBe(2);

    const updated = await updateBomLine({ lineId: line.id, componentItemId: replacement.id, quantity: 4, actorId: `${TEST_PREFIX}-operator` });
    expect(updated).toMatchObject({ componentItemId: replacement.id });
    expect(Number(updated.quantity)).toBe(4);

    await removeBomLine({ lineId: line.id, actorId: `${TEST_PREFIX}-operator` });
    await expect(prisma.bOMLine.findUnique({ where: { id: line.id } })).resolves.toBeNull();
    await expect(prisma.auditLog.count({
      where: {
        actorId: `${TEST_PREFIX}-operator`,
        action: { in: ["CREATE_BOM_SECTION", "ADD_BOM_LINE", "UPDATE_BOM_LINE_QUANTITY", "REMOVE_BOM_LINE"] }
      }
    })).resolves.toBe(4);
  });

  it("allows BOM sections only for active finished-good parent items", async () => {
    const componentParent = await createItem("COMPONENT-PARENT", ItemCategory.COMPONENT);
    const finishedParent = await createItem("FINISHED-PARENT", ItemCategory.FINISHED_GOOD);

    await expect(createBomSection({ parentItemId: componentParent.id, actorId: `${TEST_PREFIX}-operator` })).rejects.toThrow(/finished-good item/i);
    await expect(createBomSection({ parentItemId: finishedParent.id, actorId: `${TEST_PREFIX}-operator` })).resolves.toMatchObject({
      parentItemId: finishedParent.id,
      active: true
    });
  });

  it("rejects build consumption when any BOM component line is obsolete instead of silently under-consuming", async () => {
    const parent = await createItem("OBSOLETE-PARENT");
    const activeComponent = await createItem("OBSOLETE-ACTIVE-COMPONENT");
    const obsoleteComponent = await createItem("OBSOLETE-COMPONENT");
    await prisma.item.update({ where: { id: obsoleteComponent.id }, data: { lifecycleStatus: LifecycleStatus.OBSOLETE } });
    const bom = await prisma.bOM.create({
      data: {
        parentItemId: parent.id,
        version: `${TEST_PREFIX}-OBSOLETE-V1`,
        lines: { create: [
          { componentItemId: activeComponent.id, quantity: 2 },
          { componentItemId: obsoleteComponent.id, quantity: 3 }
        ] }
      }
    });

    await createStockMovement({ itemId: activeComponent.id, movementType: MovementType.RECEIVE, quantity: 10, reason: "BOM obsolete fixture", reference: `${TEST_PREFIX}-OBSOLETE-ACTIVE-RECEIPT`, actorId: `${TEST_PREFIX}-operator` });
    await createStockMovement({ itemId: obsoleteComponent.id, movementType: MovementType.RECEIVE, quantity: 10, reason: "BOM obsolete fixture", reference: `${TEST_PREFIX}-OBSOLETE-OBSOLETE-RECEIPT`, actorId: `${TEST_PREFIX}-operator` });

    await expect(consumeBomBuild({ bomId: bom.id, buildQuantity: 1, reference: `${TEST_PREFIX}-OBSOLETE-BUILD`, actorId: `${TEST_PREFIX}-operator` })).rejects.toThrow(/obsolete BOM component/i);
    await expect(prisma.stockMovement.count({ where: { reference: `${TEST_PREFIX}-OBSOLETE-BUILD` } })).resolves.toBe(0);
  });
});
