import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ItemCategory, LifecycleStatus, MovementType, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getDashboardSummary } from "./service";

const TEST_PREFIX = "TEST-DASH-STOCK";

async function cleanupTestData() {
  const imports = await prisma.emailOrderImport.findMany({
    where: { externalOrderId: { startsWith: TEST_PREFIX } },
    select: { id: true }
  });
  const importIds = imports.map((orderImport) => orderImport.id);
  if (importIds.length > 0) {
    await prisma.emailOrderLineImport.deleteMany({ where: { importId: { in: importIds } } });
    await prisma.emailOrderImport.deleteMany({ where: { id: { in: importIds } } });
  }

  await prisma.stockMovement.deleteMany({ where: { actorId: TEST_PREFIX } });

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
    await prisma.stockLot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }

  await prisma.storageLocation.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
  await prisma.supplier.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
}

async function createDashboardStockFixture() {
  const location = await prisma.storageLocation.create({
    data: { code: `${TEST_PREFIX}-LOC`, name: "Dashboard stock fixture" }
  });
  const item = await createTestItem(location.id, "ITEM", ItemCategory.COMPONENT, "Dashboard stock quantity fixture", {
    reorderPoint: 2,
    targetStock: 10,
    leadTimeDays: 3
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

async function createTestItem(
  locationId: string,
  skuSuffix: string,
  category: ItemCategory,
  description: string,
  overrides: Partial<{ reorderPoint: number; targetStock: number; leadTimeDays: number }> = {}
) {
  return prisma.item.create({
    data: {
      sku: `${TEST_PREFIX}-${skuSuffix}`,
      description,
      category,
      unit: Unit.EACH,
      reorderPoint: overrides.reorderPoint ?? 0,
      targetStock: overrides.targetStock ?? 0,
      leadTimeDays: overrides.leadTimeDays ?? 0,
      lifecycleStatus: LifecycleStatus.ACTIVE,
      storageLocationId: locationId
    }
  });
}

async function ensureLambentiAssembledPackageItem(locationId: string) {
  return prisma.item.upsert({
    where: { sku: "LAMBENTI_PACKAGE" },
    update: {},
    create: {
      sku: "LAMBENTI_PACKAGE",
      description: "Lambenti Assembled package finished good",
      category: ItemCategory.FINISHED_GOOD,
      unit: Unit.EACH,
      reorderPoint: 0,
      targetStock: 0,
      leadTimeDays: 0,
      lifecycleStatus: LifecycleStatus.ACTIVE,
      storageLocationId: locationId
    }
  });
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

  it("counts only the Lambenti assembled package finished good for the assembled packages dashboard total", async () => {
    const location = await prisma.storageLocation.create({
      data: { code: `${TEST_PREFIX}-ASSEMBLED-LOC`, name: "Dashboard assembled package fixture" }
    });
    const assembledPackage = await ensureLambentiAssembledPackageItem(location.id);
    const mainUnit = await createTestItem(location.id, "MAIN-UNIT-FG", ItemCategory.FINISHED_GOOD, "Finished Lambenti main unit subassembly");
    const ledConnector = await createTestItem(location.id, "LED-CONN-FG", ItemCategory.FINISHED_GOOD, "LED connector subassembly");

    const before = await getDashboardSummary();

    await prisma.stockMovement.createMany({
      data: [
        { itemId: assembledPackage.id, movementType: MovementType.RECEIVE, quantity: 5, reason: "assembled package fixture", actorType: "USER", actorId: TEST_PREFIX },
        { itemId: mainUnit.id, movementType: MovementType.RECEIVE, quantity: 11, reason: "subassembly fixture", actorType: "USER", actorId: TEST_PREFIX },
        { itemId: ledConnector.id, movementType: MovementType.RECEIVE, quantity: 7, reason: "subassembly fixture", actorType: "USER", actorId: TEST_PREFIX }
      ]
    });

    const after = await getDashboardSummary();

    expect(after.assembledPackages).toBe(before.assembledPackages + 5);
  });

  it("removes low-stock BOM components from current low stock when their finished build is stocked above reorder point", async () => {
    const location = await prisma.storageLocation.create({
      data: { code: `${TEST_PREFIX}-BOM-NEED-LOC`, name: "Dashboard BOM need fixture" }
    });
    const coveredBuild = await createTestItem(location.id, "COVERED-BUILD", ItemCategory.FINISHED_GOOD, "Threaded top enclosure build", { reorderPoint: 2, targetStock: 4 });
    const coveredComponent = await createTestItem(location.id, "TOP-ENCLOSURE", ItemCategory.COMPONENT, "Top enclosure component", { reorderPoint: 10, targetStock: 20 });
    const neededBuild = await createTestItem(location.id, "NEEDED-BUILD", ItemCategory.FINISHED_GOOD, "Open controller build", { reorderPoint: 3, targetStock: 6 });
    const neededComponent = await createTestItem(location.id, "CONTROL-PCB", ItemCategory.COMPONENT, "Controller PCB component", { reorderPoint: 10, targetStock: 20 });

    await prisma.bOM.create({
      data: {
        parentItemId: coveredBuild.id,
        version: `${TEST_PREFIX}-COVERED-BOM`,
        active: true,
        lines: { create: [{ componentItemId: coveredComponent.id, quantity: 1 }] }
      }
    });
    await prisma.bOM.create({
      data: {
        parentItemId: neededBuild.id,
        version: `${TEST_PREFIX}-NEEDED-BOM`,
        active: true,
        lines: { create: [{ componentItemId: neededComponent.id, quantity: 1 }] }
      }
    });
    await prisma.stockMovement.create({
      data: {
        itemId: coveredBuild.id,
        movementType: MovementType.RECEIVE,
        quantity: 3,
        reason: "covered finished build fixture",
        actorType: "USER",
        actorId: TEST_PREFIX
      }
    });

    const summary = await getDashboardSummary();

    expect(summary.lowStockItems.map((item) => item.sku)).not.toContain(`${TEST_PREFIX}-TOP-ENCLOSURE`);
    expect(summary.lowStockNotCurrentlyNeededItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sku: `${TEST_PREFIX}-TOP-ENCLOSURE`,
        notCurrentlyNeededReason: expect.stringContaining(`${TEST_PREFIX}-COVERED-BUILD`)
      })
    ]));
    expect(summary.lowStockItems.map((item) => item.sku)).toContain(`${TEST_PREFIX}-CONTROL-PCB`);
  });

  it("still exposes the Lambenti package BOM quantities when current stock gives zero build capacity", async () => {
    const location = await prisma.storageLocation.create({
      data: { code: `${TEST_PREFIX}-ZERO-BUILD-LOC`, name: "Dashboard zero capacity fixture" }
    });
    const assembledPackage = await ensureLambentiAssembledPackageItem(location.id);
    const unavailableComponent = await createTestItem(location.id, "ZERO-CAP-COMP", ItemCategory.COMPONENT, "Unavailable package component");

    await prisma.bOM.create({
      data: {
        parentItemId: assembledPackage.id,
        version: `${TEST_PREFIX}-ZERO-CAP-BOM`,
        active: true,
        lines: { create: [{ componentItemId: unavailableComponent.id, quantity: 3 }] }
      }
    });

    const summary = await getDashboardSummary();

    expect(summary.buildCapacity).toMatchObject({
      finishedSku: "LAMBENTI_PACKAGE",
      componentsRequiredPerBuild: 3,
      finishedBuildCapacity: 0,
      bottleneckSku: `${TEST_PREFIX}-ZERO-CAP-COMP`
    });
  });

  it("targets the Lambenti package BOM and sums BOM line quantities for the build capability card", async () => {
    const location = await prisma.storageLocation.create({
      data: { code: `${TEST_PREFIX}-BUILD-LOC`, name: "Dashboard build fixture" }
    });
    const assembledPackage = await ensureLambentiAssembledPackageItem(location.id);
    const componentA = await createTestItem(location.id, "COMP-A", ItemCategory.COMPONENT, "Component A");
    const componentB = await createTestItem(location.id, "COMP-B", ItemCategory.RAW_MATERIAL, "Component B");
    const competingFinishedGood = await createTestItem(location.id, "COMPETING-FG", ItemCategory.FINISHED_GOOD, "Competing finished-good BOM");
    const competingComponent = await createTestItem(location.id, "COMPETING-COMP", ItemCategory.COMPONENT, "Competing component");

    await prisma.bOM.create({
      data: {
        parentItemId: assembledPackage.id,
        version: `${TEST_PREFIX}-PACKAGE-BOM`,
        active: true,
        lines: { create: [
          { componentItemId: componentA.id, quantity: 2 },
          { componentItemId: componentB.id, quantity: 5 }
        ] }
      }
    });
    await prisma.bOM.create({
      data: {
        parentItemId: competingFinishedGood.id,
        version: `${TEST_PREFIX}-COMPETING-BOM`,
        active: true,
        lines: { create: [{ componentItemId: competingComponent.id, quantity: 1 }] }
      }
    });
    await prisma.stockMovement.createMany({
      data: [
        { itemId: componentA.id, movementType: MovementType.RECEIVE, quantity: 20, reason: "capacity fixture", actorType: "USER", actorId: TEST_PREFIX },
        { itemId: componentB.id, movementType: MovementType.RECEIVE, quantity: 30, reason: "capacity fixture", actorType: "USER", actorId: TEST_PREFIX },
        { itemId: competingComponent.id, movementType: MovementType.RECEIVE, quantity: 999, reason: "competing capacity fixture", actorType: "USER", actorId: TEST_PREFIX }
      ]
    });

    const summary = await getDashboardSummary();

    expect(summary.componentsOnHand).toBeGreaterThanOrEqual(1049);
    expect(summary.buildCapacity).toMatchObject({
      finishedSku: "LAMBENTI_PACKAGE",
      componentsRequiredPerBuild: 7,
      finishedBuildCapacity: 6,
      bottleneckSku: `${TEST_PREFIX}-COMP-B`
    });
    expect(summary.buildCapacity.componentCapacities).toEqual(expect.arrayContaining([
      expect.objectContaining({ sku: `${TEST_PREFIX}-COMP-A`, requiredPerBuild: 2, available: 20, capacity: 10 }),
      expect.objectContaining({ sku: `${TEST_PREFIX}-COMP-B`, requiredPerBuild: 5, available: 30, capacity: 6 })
    ]));
  });

  it("does not show email import catalog-matching notices on the dashboard", async () => {
    const location = await prisma.storageLocation.create({
      data: { code: `${TEST_PREFIX}-EMAIL-LOC`, name: "Dashboard email import fixture" }
    });
    const supplier = await prisma.supplier.create({
      data: {
        name: `${TEST_PREFIX}-EMAIL-SUPPLIER`,
        companyName: `${TEST_PREFIX} Email Supplier Inc.`,
        confirmedByHuman: true,
        moq: 1,
        leadTimeDays: 7,
        shippingCost: 0,
        reliabilityScore: 0.9
      }
    });
    const mainPad = await createTestItem(location.id, "EMAIL-MAIN-PAD", ItemCategory.COMPONENT, "5952 pad with tab");
    const smallPad = await createTestItem(location.id, "EMAIL-SMALL-PAD", ItemCategory.COMPONENT, "5952 pad with tab small one");
    const externalOrderId = `${TEST_PREFIX}-303671327001023166`;

    await prisma.emailOrderImport.create({
      data: {
        source: "SYNCED_EMAIL",
        sourceHash: `${TEST_PREFIX}-matched-hash`,
        rawText: `Order ${externalOrderId} manually matched`,
        externalOrderId,
        supplierName: supplier.name,
        supplierId: supplier.id,
        status: "APPLIED",
        currency: "USD",
        lines: { create: [
          { lineNo: 1, rawDescription: "5952 pad with tab", quantity: 100, unitPrice: 0.3, lineTotal: 30, currency: "USD", matchedItemId: mainPad.id, matchConfidence: "MANUAL" },
          { lineNo: 2, rawDescription: "5952 pad with tab small one", quantity: 100, unitPrice: 0.15, lineTotal: 15, currency: "USD", matchedItemId: smallPad.id, matchConfidence: "MANUAL" }
        ] }
      }
    });
    await prisma.emailOrderImport.create({
      data: {
        source: "SYNCED_EMAIL",
        sourceHash: `${TEST_PREFIX}-stale-unmatched-hash`,
        rawText: `Order ${externalOrderId} stale synced duplicate`,
        externalOrderId,
        supplierName: "Alibaba supplier",
        status: "NEEDS_REVIEW",
        currency: "USD",
        lines: { create: [
          { lineNo: 1, rawDescription: "5952 pad with tab", quantity: 100, unitPrice: 0.3, lineTotal: 30, currency: "USD", matchConfidence: "UNMATCHED" },
          { lineNo: 2, rawDescription: "5952 pad with tab small one", quantity: 100, unitPrice: 0.15, lineTotal: 15, currency: "USD", matchConfidence: "UNMATCHED" }
        ] }
      }
    });

    const summary = await getDashboardSummary();

    expect(summary.humanReviewActions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "Email import" })
    ]));
    expect(summary.humanReviewActions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: `Review order ${externalOrderId}` })
    ]));
    expect(summary.humanReviewActions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: expect.stringContaining("unmatched/uncertain line(s) need catalog matching") })
    ]));
  });
});
