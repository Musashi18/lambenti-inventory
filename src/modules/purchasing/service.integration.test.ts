import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ItemCategory, LifecycleStatus, MovementType, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createStockMovement } from "@/modules/inventory/service";
import { convertApprovedPurchaseRequestToDraftPurchaseOrder, createDraftPurchaseRequest, getPurchaseRecommendations } from "./service";

const TEST_PREFIX = "TEST-PURCH-SVC";

async function cleanupTestData() {
  const items = await prisma.item.findMany({ where: { sku: { startsWith: TEST_PREFIX } }, select: { id: true } });
  const itemIds = items.map((item) => item.id);
  const suppliers = await prisma.supplier.findMany({ where: { name: { startsWith: TEST_PREFIX } }, select: { id: true } });
  const supplierIds = suppliers.map((supplier) => supplier.id);
  const requests = await prisma.purchaseRequest.findMany({ where: { requestedBy: { startsWith: TEST_PREFIX } }, select: { id: true } });
  const requestIds = requests.map((request) => request.id);
  const orders = supplierIds.length > 0
    ? await prisma.purchaseOrder.findMany({ where: { supplierId: { in: supplierIds } }, select: { id: true } })
    : [];
  const orderIds = orders.map((order) => order.id);

  if (orderIds.length > 0) {
    await prisma.supplierInvoiceLine.deleteMany({ where: { invoice: { purchaseOrderId: { in: orderIds } } } });
    await prisma.supplierInvoice.deleteMany({ where: { purchaseOrderId: { in: orderIds } } });
    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: orderIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  }
  if (requestIds.length > 0) {
    await prisma.purchaseRequestLine.deleteMany({ where: { purchaseRequestId: { in: requestIds } } });
    await prisma.purchaseRequest.deleteMany({ where: { id: { in: requestIds } } });
  }
  if (itemIds.length > 0) {
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockLot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { startsWith: TEST_PREFIX } }, { entityId: { in: itemIds } }] } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }
  if (supplierIds.length > 0) await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
  await prisma.storageLocation.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
}

async function createFixture(options: { sku: string; reorderPoint?: number; targetStock?: number; status?: LifecycleStatus; category?: ItemCategory }) {
  const location = await prisma.storageLocation.create({
    data: { code: `${options.sku}-LOC`, name: `${options.sku} location` }
  });
  const item = await prisma.item.create({
    data: {
      sku: options.sku,
      description: `${options.sku} item`,
      category: options.category ?? ItemCategory.COMPONENT,
      unit: Unit.EACH,
      reorderPoint: options.reorderPoint ?? 5,
      targetStock: options.targetStock ?? 20,
      leadTimeDays: 7,
      lifecycleStatus: options.status ?? LifecycleStatus.ACTIVE,
      storageLocationId: location.id
    }
  });
  const supplier = await prisma.supplier.create({
    data: {
      name: `${options.sku}-SUPPLIER`,
      moq: 1,
      leadTimeDays: 7,
      shippingCost: 0,
      reliabilityScore: 0.95
    }
  });
  return { item, supplier };
}

async function receive(itemId: string, quantity: number) {
  const lot = await prisma.stockLot.create({
    data: { itemId, lotCode: `${TEST_PREFIX}-${crypto.randomUUID().slice(0, 8)}-LOT`, receivedAt: new Date("2026-06-01T00:00:00.000Z"), unitCost: 1 }
  });
  await createStockMovement({
    itemId,
    stockLotId: lot.id,
    movementType: MovementType.RECEIVE,
    quantity,
    reason: "Purchase recommendation fixture receipt",
    reference: "TEST-PO",
    actorId: `${TEST_PREFIX}-receiver`
  });
}

describe("purchase recommendation and draft request service", () => {
  beforeEach(cleanupTestData);
  afterAll(cleanupTestData);

  it("excludes finished goods from purchase recommendations and draft purchase requests", async () => {
    const { item, supplier } = await createFixture({
      sku: `${TEST_PREFIX}-FINISHED-GOOD`,
      reorderPoint: 10,
      targetStock: 50,
      category: ItemCategory.FINISHED_GOOD
    });

    const recommendations = await getPurchaseRecommendations();

    expect(recommendations.some((row) => row.itemId === item.id)).toBe(false);
    await expect(createDraftPurchaseRequest({
      itemId: item.id,
      quantity: 5,
      rationale: "Finished goods are assembled internally, not purchased",
      requestedBy: `${TEST_PREFIX}-agent`,
      supplierId: supplier.id,
      actorType: "AGENT",
      actorId: `${TEST_PREFIX}-agent`
    })).rejects.toThrow(/finished goods are assembled/i);
  });

  it("excludes obsolete items and items whose available stock is at or above reorder point", async () => {
    const active = await createFixture({ sku: `${TEST_PREFIX}-ACTIVE`, reorderPoint: 5, targetStock: 20 });
    await receive(active.item.id, 5);
    await createFixture({ sku: `${TEST_PREFIX}-OBSOLETE`, reorderPoint: 5, targetStock: 20, status: LifecycleStatus.OBSOLETE });

    const recommendations = await getPurchaseRecommendations();

    expect(recommendations.find((row) => row.itemId === active.item.id)).toBeUndefined();
    expect(recommendations.some((row) => row.sku === `${TEST_PREFIX}-OBSOLETE`)).toBe(false);
  });

  it("subtracts incoming open PO quantity and open draft/pending request quantity without going negative", async () => {
    const { item, supplier } = await createFixture({ sku: `${TEST_PREFIX}-OPEN`, reorderPoint: 10, targetStock: 20 });
    await receive(item.id, 3);
    await prisma.purchaseOrder.create({
      data: {
        supplierId: supplier.id,
        status: "ORDERED",
        lines: { create: [{ itemId: item.id, quantity: 5, unitPrice: 1 }] }
      }
    });
    await prisma.purchaseRequest.create({
      data: {
        supplierId: supplier.id,
        status: "DRAFT",
        rationale: "Existing draft should reduce recommendation",
        requestedBy: `${TEST_PREFIX}-existing-draft`,
        lines: { create: [{ itemId: item.id, quantity: 4 }] }
      }
    });

    const recommendations = await getPurchaseRecommendations();
    const row = recommendations.find((candidate) => candidate.itemId === item.id);

    expect(row).toMatchObject({ available: 3, reorderPoint: 10, targetStock: 20, recommendedOrderQuantity: 8 });
  });

  it("creates only a DRAFT purchase request and prevents duplicate open drafts for the same item", async () => {
    const { item, supplier } = await createFixture({ sku: `${TEST_PREFIX}-DRAFT`, reorderPoint: 10, targetStock: 20 });

    const first = await createDraftPurchaseRequest({
      itemId: item.id,
      quantity: 7,
      rationale: "Below reorder point",
      requestedBy: `${TEST_PREFIX}-agent`,
      supplierId: supplier.id,
      actorType: "AGENT",
      actorId: `${TEST_PREFIX}-agent`
    });

    expect(first.status).toBe("DRAFT");
    await expect(prisma.stockMovement.count({ where: { itemId: item.id } })).resolves.toBe(0);
    await expect(createDraftPurchaseRequest({
      itemId: item.id,
      quantity: 7,
      rationale: "Duplicate draft",
      requestedBy: `${TEST_PREFIX}-agent`,
      supplierId: supplier.id,
      actorType: "AGENT",
      actorId: `${TEST_PREFIX}-agent`
    })).rejects.toThrow(/open draft|pending purchase request/i);
  });

  it("converts an approved purchase request into a draft purchase order without receiving stock", async () => {
    const { item, supplier } = await createFixture({ sku: `${TEST_PREFIX}-CONVERT`, reorderPoint: 10, targetStock: 20 });
    await prisma.item.update({ where: { id: item.id }, data: { estimatedUnitCost: 2.75 } });
    const request = await prisma.purchaseRequest.create({
      data: {
        supplierId: supplier.id,
        status: "APPROVED",
        rationale: "Approved low-stock replenishment",
        requestedBy: `${TEST_PREFIX}-buyer`,
        approvedBy: `${TEST_PREFIX}-approver`,
        approvedAt: new Date("2026-06-13T00:00:00.000Z"),
        lines: { create: [{ itemId: item.id, quantity: 6 }] }
      }
    });

    const result = await convertApprovedPurchaseRequestToDraftPurchaseOrder({
      requestId: request.id,
      actor: { id: `${TEST_PREFIX}-buyer`, type: "HUMAN", role: "PURCHASING", actorType: "USER" },
      comment: "Draft PO for operator review before ordering."
    });

    expect(result.purchaseRequest.status).toBe("CONVERTED");
    expect(result.purchaseOrder).toMatchObject({
      purchaseRequestId: request.id,
      supplierId: supplier.id,
      status: "DRAFT"
    });
    expect(result.purchaseOrder.lines).toHaveLength(1);
    expect(Number(result.purchaseOrder.lines[0].unitPrice)).toBe(2.75);
    await expect(prisma.stockMovement.count({ where: { itemId: item.id } })).resolves.toBe(0);
    await expect(prisma.auditLog.findFirstOrThrow({ where: { entityId: request.id, action: "CONVERT_PURCHASE_REQUEST_TO_DRAFT_PO" } })).resolves.toMatchObject({
      actorId: `${TEST_PREFIX}-buyer`
    });
  });

  it("blocks conversion when supplier or unit price evidence is missing", async () => {
    const missingSupplier = await createFixture({ sku: `${TEST_PREFIX}-NO-SUPPLIER`, reorderPoint: 10, targetStock: 20 });
    const noSupplierRequest = await prisma.purchaseRequest.create({
      data: {
        status: "APPROVED",
        rationale: "No supplier selected",
        requestedBy: `${TEST_PREFIX}-buyer`,
        approvedBy: `${TEST_PREFIX}-approver`,
        approvedAt: new Date("2026-06-13T00:00:00.000Z"),
        lines: { create: [{ itemId: missingSupplier.item.id, quantity: 2, targetUnitPrice: 1.25 }] }
      }
    });

    await expect(convertApprovedPurchaseRequestToDraftPurchaseOrder({
      requestId: noSupplierRequest.id,
      actor: { id: `${TEST_PREFIX}-buyer`, type: "HUMAN", role: "PURCHASING", actorType: "USER" }
    })).rejects.toThrow(/supplier/i);

    const missingPrice = await createFixture({ sku: `${TEST_PREFIX}-NO-PRICE`, reorderPoint: 10, targetStock: 20 });
    const noPriceRequest = await prisma.purchaseRequest.create({
      data: {
        supplierId: missingPrice.supplier.id,
        status: "APPROVED",
        rationale: "No price evidence",
        requestedBy: `${TEST_PREFIX}-buyer`,
        approvedBy: `${TEST_PREFIX}-approver`,
        approvedAt: new Date("2026-06-13T00:00:00.000Z"),
        lines: { create: [{ itemId: missingPrice.item.id, quantity: 2 }] }
      }
    });

    await expect(convertApprovedPurchaseRequestToDraftPurchaseOrder({
      requestId: noPriceRequest.id,
      actor: { id: `${TEST_PREFIX}-buyer`, type: "HUMAN", role: "PURCHASING", actorType: "USER" }
    })).rejects.toThrow(/unit price/i);
  });
});
