import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemCategory, LifecycleStatus, MovementType, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

import { receiveIncomingPurchaseOrderLineFormAction } from "./actions";

const TEST_PREFIX = "TEST-INCOMING-ACTION";
const EMPTY_STATE = { success: false, message: "", fieldErrors: {}, values: {} };

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
  const orders = supplierIds.length > 0
    ? await prisma.purchaseOrder.findMany({ where: { supplierId: { in: supplierIds } }, select: { id: true } })
    : [];
  const orderIds = orders.map((order) => order.id);

  if (itemIds.length > 0) {
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockLot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: { startsWith: TEST_PREFIX } },
          { entityId: { in: itemIds } },
          { entityId: { in: orderIds } }
        ]
      }
    });
    await prisma.purchaseOrderLine.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.purchaseRequestLine.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }

  if (orderIds.length > 0) {
    await prisma.supplierInvoiceLine.deleteMany({ where: { invoice: { purchaseOrderId: { in: orderIds } } } });
    await prisma.supplierInvoice.deleteMany({ where: { purchaseOrderId: { in: orderIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  }

  if (supplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
  }

  await prisma.storageLocation.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
}

async function createIncomingFixture(suffix: string, quantity = 10) {
  const location = await prisma.storageLocation.create({
    data: { code: `${TEST_PREFIX}-${suffix}-LOC`, name: `Incoming action test ${suffix}` }
  });
  const supplier = await prisma.supplier.create({
    data: {
      name: `${TEST_PREFIX}-${suffix}-SUPPLIER`,
      confirmedByHuman: true,
      moq: 1,
      leadTimeDays: 7,
      shippingCost: 0,
      reliabilityScore: 0.9
    }
  });
  const item = await prisma.item.create({
    data: {
      sku: `${TEST_PREFIX}-${suffix}-ITEM`,
      description: `Incoming action test item ${suffix}`,
      category: ItemCategory.COMPONENT,
      unit: Unit.EACH,
      reorderPoint: 0,
      targetStock: 0,
      leadTimeDays: 0,
      lifecycleStatus: LifecycleStatus.ACTIVE,
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
        create: [{ itemId: item.id, quantity, unitPrice: 2.5 }]
      }
    },
    include: { lines: true }
  });

  return { item, supplier, order, line: order.lines[0] };
}

function receiveForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  const values = {
    purchaseOrderLineId: "",
    quantity: "4",
    lotCode: `${TEST_PREFIX}-LOT`,
    receivedAt: "2026-06-03",
    unitCost: "2.50",
    currency: "USD",
    reference: "PACKING-SLIP-TEST",
    notes: "Human counted package at receiving bench",
    overrideReason: "",
    ...overrides
  };

  for (const [key, value] of Object.entries(values)) {
    form.set(key, value);
  }
  return form;
}

describe("incoming receiving server-action contract", () => {
  beforeEach(async () => {
    vi.stubEnv("LAMBENTI_DEV_USER_ROLE", "OPERATIONS");
    vi.stubEnv("LAMBENTI_DEV_USER_ID", `${TEST_PREFIX}-ops`);
    await cleanupTestData();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  afterAll(cleanupTestData);

  it("receives counted stock against a PO line, links the ledger movement, updates PO progress, and leaves invoices untouched", async () => {
    const { item, order, line } = await createIncomingFixture("PARTIAL");

    const result = await receiveIncomingPurchaseOrderLineFormAction(EMPTY_STATE, receiveForm({
      purchaseOrderLineId: line.id,
      lotCode: `${TEST_PREFIX}-PARTIAL-LOT`,
      reference: "PACKING-SLIP-PARTIAL"
    }));

    expect(result).toMatchObject({ success: true });
    expect(result.message).toMatch(/received 4/i);

    await expect(prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: line.id } })).resolves.toMatchObject({
      receivedQuantity: 4
    });
    await expect(prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })).resolves.toMatchObject({
      status: "PARTIALLY_RECEIVED"
    });

    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { itemId: item.id, reference: "PACKING-SLIP-PARTIAL" } });
    expect(movement).toMatchObject({
      movementType: MovementType.RECEIVE,
      quantity: 4,
      purchaseOrderLineId: line.id,
      actorId: `${TEST_PREFIX}-ops`
    });
    await expect(prisma.stockLot.count({ where: { itemId: item.id, lotCode: `${TEST_PREFIX}-PARTIAL-LOT` } })).resolves.toBe(1);
    await expect(prisma.auditLog.count({ where: { actorId: `${TEST_PREFIX}-ops`, action: "RECEIVE_PURCHASE_ORDER_LINE", entityId: line.id } })).resolves.toBe(1);
    await expect(prisma.supplierInvoice.count({ where: { purchaseOrderId: order.id } })).resolves.toBe(0);
  });

  it("returns inline errors and writes no stock movement when a non-admin over-receives", async () => {
    const { item, line } = await createIncomingFixture("OVER");

    const result = await receiveIncomingPurchaseOrderLineFormAction(EMPTY_STATE, receiveForm({
      purchaseOrderLineId: line.id,
      quantity: "11",
      lotCode: `${TEST_PREFIX}-OVER-LOT`,
      reference: "PACKING-SLIP-OVER"
    }));

    expect(result).toMatchObject({ success: false, domainErrorCode: "OVER_RECEIPT" });
    expect(result.message).toMatch(/remaining ordered quantity/i);
    await expect(prisma.stockMovement.count({ where: { itemId: item.id } })).resolves.toBe(0);
    await expect(prisma.stockLot.count({ where: { itemId: item.id, lotCode: `${TEST_PREFIX}-OVER-LOT` } })).resolves.toBe(0);
  });

  it("blocks viewers before receiving mutates inventory", async () => {
    vi.stubEnv("LAMBENTI_DEV_USER_ROLE", "VIEWER");
    vi.stubEnv("LAMBENTI_DEV_USER_ID", `${TEST_PREFIX}-viewer`);
    const { item, line } = await createIncomingFixture("VIEWER");

    const result = await receiveIncomingPurchaseOrderLineFormAction(EMPTY_STATE, receiveForm({
      purchaseOrderLineId: line.id,
      lotCode: `${TEST_PREFIX}-VIEWER-LOT`,
      reference: "PACKING-SLIP-VIEWER"
    }));

    expect(result).toMatchObject({ success: false, domainErrorCode: "UNAUTHORIZED" });
    expect(result.message).toMatch(/receiving:confirm/i);
    await expect(prisma.stockMovement.count({ where: { itemId: item.id } })).resolves.toBe(0);
  });
});
