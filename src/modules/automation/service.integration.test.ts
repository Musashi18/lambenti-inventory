import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ItemCategory, LifecycleStatus, MovementType, PurchaseOrderStatus, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createStockMovement } from "@/modules/inventory/service";
import { createDraftPurchaseRequestFromFinding, runInventoryAnomalyScan, runStockReorderScan, ignoreAutomationFinding } from "./service";

const TEST_PREFIX = "TEST-AUTOMATION";

async function cleanupTestData() {
  await prisma.automationFinding.deleteMany({ where: { entityId: { startsWith: TEST_PREFIX } } });
  await prisma.automationRun.deleteMany({ where: { actorId: { startsWith: TEST_PREFIX } } });

  const items = await prisma.item.findMany({
    where: { sku: { startsWith: TEST_PREFIX } },
    select: { id: true }
  });
  const itemIds = items.map((item) => item.id);
  const suppliers = await prisma.supplier.findMany({
    where: { name: { startsWith: TEST_PREFIX } },
    select: { id: true }
  });
  const supplierIds = suppliers.map((supplier) => supplier.id);
  const requests = await prisma.purchaseRequest.findMany({
    where: { requestedBy: { startsWith: TEST_PREFIX } },
    select: { id: true }
  });
  const requestIds = requests.map((request) => request.id);
  const orders = supplierIds.length > 0
    ? await prisma.purchaseOrder.findMany({ where: { supplierId: { in: supplierIds } }, select: { id: true } })
    : [];
  const orderIds = orders.map((order) => order.id);

  if (itemIds.length > 0) {
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockLot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.purchaseOrderLine.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.purchaseRequestLine.deleteMany({ where: { itemId: { in: itemIds } } });
  }
  if (requestIds.length > 0) await prisma.purchaseRequest.deleteMany({ where: { id: { in: requestIds } } });
  if (orderIds.length > 0) await prisma.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  if (itemIds.length > 0) await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  if (supplierIds.length > 0) await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
  await prisma.storageLocation.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: TEST_PREFIX } } });
}

async function createItemFixture(suffix: string, overrides: Partial<{ reorderPoint: number; targetStock: number; lifecycleStatus: LifecycleStatus; preferredSupplierId: string | null; category: ItemCategory }> = {}) {
  const location = await prisma.storageLocation.create({
    data: { code: `${TEST_PREFIX}-${suffix}-LOC`, name: `Automation ${suffix}` }
  });
  return prisma.item.create({
    data: {
      sku: `${TEST_PREFIX}-${suffix}-ITEM`,
      description: `Automation test item ${suffix}`,
      category: overrides.category ?? ItemCategory.COMPONENT,
      unit: Unit.EACH,
      reorderPoint: overrides.reorderPoint ?? 5,
      targetStock: overrides.targetStock ?? 20,
      leadTimeDays: 7,
      lifecycleStatus: overrides.lifecycleStatus ?? LifecycleStatus.ACTIVE,
      preferredSupplierId: overrides.preferredSupplierId ?? undefined,
      storageLocationId: location.id
    }
  });
}

describe("automation runs and findings", () => {
  beforeEach(cleanupTestData);
  afterAll(cleanupTestData);

  it("writes a succeeded stock reorder automation run and dedupes repeat shortage findings", async () => {
    const item = await createItemFixture("REORDER", { reorderPoint: 5, targetStock: 25 });

    const first = await runStockReorderScan({ actorType: "AGENT", actorId: `${TEST_PREFIX}-agent` });
    const second = await runStockReorderScan({ actorType: "AGENT", actorId: `${TEST_PREFIX}-agent` });

    expect(first.run.status).toBe("SUCCEEDED");
    expect(second.run.status).toBe("SUCCEEDED");
    const runs = await prisma.automationRun.findMany({ where: { kind: "STOCK_REORDER_SCAN", actorId: `${TEST_PREFIX}-agent` } });
    expect(runs).toHaveLength(2);

    const findings = await prisma.automationFinding.findMany({ where: { entityId: item.id, category: "REORDER_SHORTAGE" } });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "HIGH",
      status: "OPEN",
      suggestedActionType: "DRAFT_PURCHASE_REQUEST"
    });
    expect(findings[0].suggestedActionJson).toMatchObject({
      itemId: item.id,
      suggestedQuantity: 25,
      learnedLeadTimeDays: 7,
      reorderBufferDays: 7,
      projectedAvailableWithIncoming: 0
    });
    expect(findings[0].message).toContain("learned order-to-receipt buffer");
  });

  it("does not create reorder findings for finished goods because they are assembled internally", async () => {
    const item = await createItemFixture("FINISHED-GOOD", {
      reorderPoint: 5,
      targetStock: 25,
      category: ItemCategory.FINISHED_GOOD
    });

    const scan = await runStockReorderScan({ actorType: "AGENT", actorId: `${TEST_PREFIX}-agent` });

    expect(scan.findings.some((row) => row.entityId === item.id && row.category === "REORDER_SHORTAGE")).toBe(false);
    await expect(prisma.automationFinding.count({ where: { entityId: item.id, category: "REORDER_SHORTAGE" } })).resolves.toBe(0);
  });

  it("does not create reorder findings when incoming supply covers the shortage", async () => {
    const supplier = await prisma.supplier.create({
      data: { name: `${TEST_PREFIX}-COVERED-SUPPLIER`, moq: 1, leadTimeDays: 5, shippingCost: 0, reliabilityScore: 0.9 }
    });
    const item = await createItemFixture("COVERED", { reorderPoint: 5, targetStock: 20, preferredSupplierId: supplier.id });
    await prisma.purchaseOrder.create({
      data: {
        supplierId: supplier.id,
        status: "ORDERED",
        expectedAt: new Date("2026-06-30T00:00:00.000Z"),
        lines: { create: [{ itemId: item.id, quantity: 20, unitPrice: 1.5 }] }
      }
    });

    await runStockReorderScan({ actorType: "AGENT", actorId: `${TEST_PREFIX}-agent` });

    await expect(prisma.automationFinding.count({ where: { entityId: item.id, category: "REORDER_SHORTAGE" } })).resolves.toBe(0);
  });

  it("resolves stale reorder findings when incoming supply later covers the shortage", async () => {
    const supplier = await prisma.supplier.create({
      data: { name: `${TEST_PREFIX}-STALE-SUPPLIER`, moq: 1, leadTimeDays: 5, shippingCost: 0, reliabilityScore: 0.9 }
    });
    const item = await createItemFixture("STALE", { reorderPoint: 5, targetStock: 20, preferredSupplierId: supplier.id });
    const first = await runStockReorderScan({ actorType: "AGENT", actorId: `${TEST_PREFIX}-agent` });
    const finding = first.findings.find((row) => row.entityId === item.id && row.category === "REORDER_SHORTAGE");
    expect(finding).toBeTruthy();

    await prisma.purchaseOrder.create({
      data: {
        supplierId: supplier.id,
        status: PurchaseOrderStatus.ORDERED,
        expectedAt: new Date("2026-07-01T00:00:00.000Z"),
        lines: { create: [{ itemId: item.id, quantity: 20, unitPrice: 1.5 }] }
      }
    });

    const second = await runStockReorderScan({ actorType: "AGENT", actorId: `${TEST_PREFIX}-agent` });

    expect(second.findings.some((row) => row.entityId === item.id && row.category === "REORDER_SHORTAGE")).toBe(false);
    await expect(prisma.automationFinding.findUniqueOrThrow({ where: { id: finding!.id } })).resolves.toMatchObject({
      status: "RESOLVED",
      resolvedAt: expect.any(Date)
    });
  });

  it("creates a draft purchase request from a reorder finding without receiving stock", async () => {
    const item = await createItemFixture("DRAFT-PR", { reorderPoint: 5, targetStock: 18 });
    const scan = await runStockReorderScan({ actorType: "AGENT", actorId: `${TEST_PREFIX}-agent` });
    const finding = scan.findings.find((row) => row.entityId === item.id && row.category === "REORDER_SHORTAGE");
    expect(finding).toBeTruthy();
    const stockBefore = await prisma.stockMovement.count({ where: { itemId: item.id } });

    const result = await createDraftPurchaseRequestFromFinding({
      findingId: finding!.id,
      actorType: "USER",
      actorId: `${TEST_PREFIX}-operator`
    });

    const stockAfter = await prisma.stockMovement.count({ where: { itemId: item.id } });
    expect(result.purchaseRequest).toMatchObject({ status: "DRAFT", requestedBy: `${TEST_PREFIX}-operator` });
    expect(result.purchaseRequest.lines).toEqual([expect.objectContaining({ itemId: item.id, quantity: 18 })]);
    expect(stockAfter).toBe(stockBefore);
    await expect(prisma.automationFinding.findUniqueOrThrow({ where: { id: finding!.id } })).resolves.toMatchObject({ status: "RESOLVED" });
  });

  it("keeps obsolete items invisible to automation anomaly checks without mutating stock", async () => {
    const item = await createItemFixture("OBSOLETE", { lifecycleStatus: LifecycleStatus.OBSOLETE, reorderPoint: 0, targetStock: 0 });
    const lot = await prisma.stockLot.create({
      data: { itemId: item.id, lotCode: `${TEST_PREFIX}-OBSOLETE-LOT`, receivedAt: new Date("2026-06-01T00:00:00.000Z"), unitCost: 0 }
    });
    await createStockMovement({
      itemId: item.id,
      stockLotId: lot.id,
      movementType: MovementType.RECEIVE,
      quantity: 3,
      reason: "Automation anomaly fixture receipt",
      reference: "TEST-AUTOMATION-RECEIPT",
      actorId: `${TEST_PREFIX}-operator`
    });

    const beforeCount = await prisma.stockMovement.count({ where: { itemId: item.id } });
    const result = await runInventoryAnomalyScan({ actorType: "AGENT", actorId: `${TEST_PREFIX}-agent` });
    const afterCount = await prisma.stockMovement.count({ where: { itemId: item.id } });

    expect(result.run.status).toBe("SUCCEEDED");
    expect(afterCount).toBe(beforeCount);
    await expect(prisma.automationFinding.count({ where: { entityId: item.id } })).resolves.toBe(0);
    await expect(prisma.automationFinding.count({ where: { entityId: lot.id } })).resolves.toBe(0);
  });

  it("keeps ignored anomaly findings dismissed across future scans by dedupe key", async () => {
    const item = await createItemFixture("IGNORE", { reorderPoint: 0, targetStock: 0 });
    const first = await runInventoryAnomalyScan({ actorType: "AGENT", actorId: `${TEST_PREFIX}-agent` });
    const finding = first.findings.find((row) => row.entityId === item.id && row.category === "ITEM_WITHOUT_PREFERRED_SUPPLIER");
    expect(finding).toBeTruthy();

    await ignoreAutomationFinding({
      findingId: finding!.id,
      actorType: "USER",
      actorId: `${TEST_PREFIX}-operator`
    });
    const second = await runInventoryAnomalyScan({ actorType: "AGENT", actorId: `${TEST_PREFIX}-agent` });

    expect(second.findings.some((row) => row.entityId === item.id)).toBe(false);
    const persisted = await prisma.automationFinding.findUniqueOrThrow({ where: { id: finding!.id } });
    expect(persisted.status).toBe("DISMISSED");
    expect(persisted.resolvedAt).toBeInstanceOf(Date);
  });
});
