import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ItemCategory, LifecycleStatus, MovementType, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calculateStockPosition } from "@/modules/inventory/ledger";
import { createStockMovementReversal } from "@/modules/inventory/service";
import { receivePurchaseOrderLine } from "./receiving";

const TEST_PREFIX = "TEST-RECEIVING";

const operationsActor = (id: string) => ({ id, role: "OPERATIONS" as const, type: "HUMAN" as const, actorType: "USER" as const });
const agentActor = (id: string) => ({ id, role: "AGENT" as const, type: "AGENT" as const, actorType: "AGENT" as const });
const spoofedAgentAdminActor = (id: string) => ({ id, role: "ADMIN" as const, type: "AGENT" as const, actorType: "AGENT" as const });

async function cleanupTestData() {
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
  const orders = await prisma.purchaseOrder.findMany({
    where: { supplierId: { in: supplierIds } },
    select: { id: true }
  });
  const orderIds = orders.map((order) => order.id);

  if (itemIds.length > 0) {
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockLot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { startsWith: TEST_PREFIX } }, { entityId: { in: orderIds } }] } });
    await prisma.purchaseOrderLine.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.purchaseRequestLine.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }
  if (orderIds.length > 0) {
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  }
  if (supplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
  }
  await prisma.storageLocation.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
}

async function createReceivingFixture(suffix: string, itemStatus: LifecycleStatus = LifecycleStatus.ACTIVE) {
  const location = await prisma.storageLocation.create({
    data: { code: `${TEST_PREFIX}-${suffix}-LOC`, name: `Receiving test ${suffix}` }
  });
  const supplier = await prisma.supplier.create({
    data: {
      name: `${TEST_PREFIX}-${suffix}-SUPPLIER`,
      moq: 1,
      leadTimeDays: 7,
      shippingCost: 0,
      reliabilityScore: 0.9
    }
  });
  const item = await prisma.item.create({
    data: {
      sku: `${TEST_PREFIX}-${suffix}-ITEM`,
      description: `Receiving test item ${suffix}`,
      category: ItemCategory.COMPONENT,
      unit: Unit.EACH,
      reorderPoint: 0,
      targetStock: 0,
      leadTimeDays: 0,
      lifecycleStatus: itemStatus,
      storageLocationId: location.id
    }
  });
  const order = await prisma.purchaseOrder.create({
    data: {
      supplierId: supplier.id,
      status: "ORDERED",
      orderedAt: new Date("2026-06-01T00:00:00.000Z"),
      expectedAt: new Date("2026-06-10T00:00:00.000Z"),
      lines: {
        create: [{ itemId: item.id, quantity: 10, unitPrice: 2.5 }]
      }
    },
    include: { lines: true }
  });

  return { item, order, line: order.lines[0] };
}

describe("human-confirmed receiving from purchase orders", () => {
  beforeEach(cleanupTestData);
  afterAll(cleanupTestData);

  it("receives a partial PO line through the ledger, creates a lot, updates PO progress, and audits the action", async () => {
    const { item, order, line } = await createReceivingFixture("PARTIAL");

    const result = await receivePurchaseOrderLine({
      purchaseOrderLineId: line.id,
      quantity: 4,
      actor: operationsActor(`${TEST_PREFIX}-ops`),
      lot: {
        lotCode: `${TEST_PREFIX}-PARTIAL-LOT`,
        receivedAt: new Date("2026-06-03T00:00:00.000Z"),
        unitCost: 2.5,
        currency: "CAD"
      },
      reference: "PO-RECEIVE-PARTIAL",
      notes: "Human counted four units at bench receiving"
    });

    expect(result.purchaseOrder.status).toBe("PARTIALLY_RECEIVED");
    expect(result.purchaseOrderLine.receivedQuantity).toBe(4);
    expect(result.stockMovement).toMatchObject({
      itemId: item.id,
      movementType: MovementType.RECEIVE
    });
    expect(Number(result.stockMovement.quantity)).toBe(4);

    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { itemId: item.id } });
    expect((movement as { purchaseOrderLineId?: string }).purchaseOrderLineId).toBe(line.id);
    const invoiceCount = await prisma.supplierInvoice.count({ where: { purchaseOrderId: order.id } });
    expect(invoiceCount).toBe(0);
    await expect(prisma.auditLog.count({ where: { actorId: `${TEST_PREFIX}-ops`, action: "RECEIVE_PURCHASE_ORDER_LINE" } })).resolves.toBe(1);
  });

  it("rejects over-receipt without override before writing movements", async () => {
    const { item, line } = await createReceivingFixture("OVER");

    await expect(receivePurchaseOrderLine({
      purchaseOrderLineId: line.id,
      quantity: 11,
      actor: operationsActor(`${TEST_PREFIX}-ops`),
      lot: {
        lotCode: `${TEST_PREFIX}-OVER-LOT`,
        receivedAt: new Date("2026-06-03T00:00:00.000Z"),
        unitCost: 2.5,
        currency: "CAD"
      },
      reference: "PO-OVER",
      notes: "Attempted over receipt"
    })).rejects.toThrow(/more than remaining/i);

    await expect(prisma.stockMovement.count({ where: { itemId: item.id } })).resolves.toBe(0);
  });

  it("blocks agent actors from receiving physical stock even if the caller tries to pass an admin role", async () => {
    const { item, line } = await createReceivingFixture("AGENT");

    await expect(receivePurchaseOrderLine({
      purchaseOrderLineId: line.id,
      quantity: 1,
      actor: spoofedAgentAdminActor(`${TEST_PREFIX}-agent-admin`),
      lot: {
        lotCode: `${TEST_PREFIX}-AGENT-LOT`,
        receivedAt: new Date("2026-06-03T00:00:00.000Z"),
        unitCost: 2.5,
        currency: "CAD"
      },
      reference: "PO-AGENT",
      notes: "Agent should not receive"
    })).rejects.toThrow(/human actor/i);

    await expect(receivePurchaseOrderLine({
      purchaseOrderLineId: line.id,
      quantity: 1,
      actor: agentActor(`${TEST_PREFIX}-agent`),
      lot: {
        lotCode: `${TEST_PREFIX}-AGENT-LOT-2`,
        receivedAt: new Date("2026-06-03T00:00:00.000Z"),
        unitCost: 2.5,
        currency: "CAD"
      },
      reference: "PO-AGENT-2",
      notes: "Agent should not receive"
    })).rejects.toThrow(/human actor/i);

    await expect(prisma.stockMovement.count({ where: { itemId: item.id } })).resolves.toBe(0);
  });

  it("requires exactly one lot source instead of accepting ambiguous or missing receiving provenance", async () => {
    const { item, line } = await createReceivingFixture("LOT-PROVENANCE");

    await expect(receivePurchaseOrderLine({
      purchaseOrderLineId: line.id,
      quantity: 1,
      actor: operationsActor(`${TEST_PREFIX}-ops`),
      reference: "PO-NO-LOT",
      notes: "Missing lot provenance"
    } as unknown as Parameters<typeof receivePurchaseOrderLine>[0])).rejects.toThrow(/exactly one/i);

    await expect(receivePurchaseOrderLine({
      purchaseOrderLineId: line.id,
      quantity: 1,
      actor: operationsActor(`${TEST_PREFIX}-ops`),
      stockLotId: "some-existing-lot-id",
      lot: {
        lotCode: `${TEST_PREFIX}-AMBIGUOUS-LOT`,
        receivedAt: new Date("2026-06-03T00:00:00.000Z"),
        unitCost: 2.5,
        currency: "CAD"
      },
      reference: "PO-AMBIGUOUS-LOT",
      notes: "Ambiguous lot provenance"
    } as unknown as Parameters<typeof receivePurchaseOrderLine>[0])).rejects.toThrow(/exactly one/i);

    await expect(prisma.stockMovement.count({ where: { itemId: item.id } })).resolves.toBe(0);
  });

  it("voids a PO receipt with the original lot linkage and rolls received quantity/status back", async () => {
    const { item, order, line } = await createReceivingFixture("VOID-RECEIPT");
    const receipt = await receivePurchaseOrderLine({
      purchaseOrderLineId: line.id,
      quantity: 4,
      actor: operationsActor(`${TEST_PREFIX}-ops`),
      lot: {
        lotCode: `${TEST_PREFIX}-VOID-RECEIPT-LOT`,
        receivedAt: new Date("2026-06-03T00:00:00.000Z"),
        unitCost: 2.5,
        currency: "CAD"
      },
      reference: "PO-VOID-RECEIPT",
      notes: "Human counted four units at bench receiving"
    });

    const reversal = await createStockMovementReversal({
      movementId: receipt.stockMovement.id,
      actorId: `${TEST_PREFIX}-ops`,
      reason: "Operator deleted mistaken PO receipt"
    });

    expect(reversal).toMatchObject({
      itemId: item.id,
      stockLotId: receipt.stockMovement.stockLotId,
      movementType: MovementType.CONSUME,
      reference: `VOID:${receipt.stockMovement.id}`
    });
    expect(Number(reversal.quantity)).toBe(4);

    await expect(prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: line.id } })).resolves.toMatchObject({ receivedQuantity: 0 });
    await expect(prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })).resolves.toMatchObject({ status: "ORDERED" });

    const itemPosition = calculateStockPosition(await prisma.stockMovement.findMany({
      where: { itemId: item.id },
      select: { movementType: true, quantity: true }
    }));
    const lotPosition = calculateStockPosition(await prisma.stockMovement.findMany({
      where: { stockLotId: receipt.stockMovement.stockLotId },
      select: { movementType: true, quantity: true }
    }));
    expect(itemPosition).toEqual({ onHand: 0, reserved: 0, available: 0 });
    expect(lotPosition).toEqual({ onHand: 0, reserved: 0, available: 0 });

    const voidAudit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "VOID_STOCK_MOVEMENT", entityType: "StockMovement", entityId: receipt.stockMovement.id }
    });
    expect(voidAudit.payload).toMatchObject({
      reversalMovementId: reversal.id,
      originalStockLotId: receipt.stockMovement.stockLotId,
      originalPurchaseOrderLineId: line.id,
      purchaseOrderRollback: {
        purchaseOrderLineId: line.id,
        purchaseOrderId: order.id,
        receivedQuantity: 0,
        status: "ORDERED"
      }
    });

    await expect(createStockMovementReversal({
      movementId: receipt.stockMovement.id,
      actorId: `${TEST_PREFIX}-ops`,
      reason: "Attempt duplicate void"
    })).rejects.toThrow(/already been voided/i);
  });
});
