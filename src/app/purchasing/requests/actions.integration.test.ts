import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemCategory, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { approvePurchaseRequestAction, convertApprovedPurchaseRequestAction, rejectPurchaseRequestAction } from "./actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const TEST_PREFIX = "TEST-PR-ACTION";

async function cleanupTestData() {
  const requests = await prisma.purchaseRequest.findMany({
    where: { requestedBy: { startsWith: TEST_PREFIX } },
    select: { id: true }
  });
  const requestIds = requests.map((request) => request.id);
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
  const orderFilters = [
    ...(requestIds.length > 0 ? [{ purchaseRequestId: { in: requestIds } }] : []),
    ...(supplierIds.length > 0 ? [{ supplierId: { in: supplierIds } }] : [])
  ];
  const orders = orderFilters.length > 0
    ? await prisma.purchaseOrder.findMany({ where: { OR: orderFilters }, select: { id: true } })
    : [];
  const orderIds = orders.map((order) => order.id);

  if (orderIds.length > 0) {
    await prisma.supplierInvoiceLine.deleteMany({ where: { invoice: { purchaseOrderId: { in: orderIds } } } });
    await prisma.supplierInvoice.deleteMany({ where: { purchaseOrderId: { in: orderIds } } });
    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: orderIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  }

  if (requestIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: requestIds } } });
    await prisma.purchaseRequestLine.deleteMany({ where: { purchaseRequestId: { in: requestIds } } });
    await prisma.purchaseRequest.deleteMany({ where: { id: { in: requestIds } } });
  }
  if (itemIds.length > 0) {
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockLot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }
  if (supplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
  }
  await prisma.storageLocation.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: TEST_PREFIX } } });
}

async function createFixture(status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" = "PENDING_APPROVAL") {
  const location = await prisma.storageLocation.create({
    data: { code: `${TEST_PREFIX}-${crypto.randomUUID().slice(0, 8)}-LOC`, name: "PR action location" }
  });
  const supplier = await prisma.supplier.create({
    data: {
      name: `${TEST_PREFIX}-${crypto.randomUUID().slice(0, 8)}-SUPPLIER`,
      moq: 1,
      leadTimeDays: 5,
      shippingCost: 0,
      reliabilityScore: 0.9
    }
  });
  const item = await prisma.item.create({
    data: {
      sku: `${TEST_PREFIX}-${crypto.randomUUID().slice(0, 8)}-ITEM`,
      description: "Purchase request action item",
      category: ItemCategory.COMPONENT,
      unit: Unit.EACH,
      reorderPoint: 1,
      targetStock: 5,
      leadTimeDays: 5,
      storageLocationId: location.id
    }
  });
  const request = await prisma.purchaseRequest.create({
    data: {
      supplierId: supplier.id,
      status,
      rationale: "Action permission test",
      requestedBy: `${TEST_PREFIX}-requester`,
      lines: { create: [{ itemId: item.id, quantity: 3 }] }
    }
  });
  return { request, item, supplier };
}

function formDataFor(requestId: string, extra?: Record<string, string>) {
  const formData = new FormData();
  formData.set("requestId", requestId);
  for (const [key, value] of Object.entries(extra ?? {})) formData.set(key, value);
  return formData;
}

describe("purchase request server-action authorization and state machine", () => {
  beforeEach(async () => {
    vi.unstubAllEnvs();
    await cleanupTestData();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await cleanupTestData();
  });

  it("blocks AGENT from approving purchase requests and leaves status/audit unchanged", async () => {
    vi.stubEnv("LAMBENTI_DEV_USER_ROLE", "AGENT");
    vi.stubEnv("LAMBENTI_DEV_USER_ID", `${TEST_PREFIX}-agent`);
    const { request } = await createFixture("PENDING_APPROVAL");

    await expect(approvePurchaseRequestAction(formDataFor(request.id))).rejects.toThrow(/permission/i);

    await expect(prisma.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } })).resolves.toMatchObject({
      status: "PENDING_APPROVAL",
      approvedBy: null
    });
    await expect(prisma.auditLog.count({ where: { entityId: request.id } })).resolves.toBe(0);
  });

  it("records the authenticated purchasing actor when approving", async () => {
    vi.stubEnv("LAMBENTI_DEV_USER_ROLE", "PURCHASING");
    vi.stubEnv("LAMBENTI_DEV_USER_ID", `${TEST_PREFIX}-buyer`);
    const { request } = await createFixture("PENDING_APPROVAL");

    await approvePurchaseRequestAction(formDataFor(request.id, { comment: "Approved for Phase I build buffer." }));

    await expect(prisma.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } })).resolves.toMatchObject({
      status: "APPROVED",
      approvedBy: `${TEST_PREFIX}-buyer`
    });
    await expect(prisma.auditLog.findFirstOrThrow({ where: { entityId: request.id, action: "APPROVE_PURCHASE_REQUEST" } })).resolves.toMatchObject({
      actorId: `${TEST_PREFIX}-buyer`
    });
  });

  it("rejects invalid terminal purchase request transitions", async () => {
    vi.stubEnv("LAMBENTI_DEV_USER_ROLE", "PURCHASING");
    vi.stubEnv("LAMBENTI_DEV_USER_ID", `${TEST_PREFIX}-buyer`);
    const { request } = await createFixture("APPROVED");

    await expect(rejectPurchaseRequestAction(formDataFor(request.id, { comment: "Too late" }))).rejects.toThrow(/cannot transition/i);

    await expect(prisma.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } })).resolves.toMatchObject({
      status: "APPROVED"
    });
  });

  it("blocks AGENT from converting approved purchase requests into purchase orders", async () => {
    vi.stubEnv("LAMBENTI_DEV_USER_ROLE", "AGENT");
    vi.stubEnv("LAMBENTI_DEV_USER_ID", `${TEST_PREFIX}-agent`);
    const { request, item } = await createFixture("APPROVED");
    await prisma.item.update({ where: { id: item.id }, data: { estimatedUnitCost: 1.5 } });

    await expect(convertApprovedPurchaseRequestAction(formDataFor(request.id))).rejects.toThrow(/permission/i);

    await expect(prisma.purchaseOrder.count({ where: { purchaseRequestId: request.id } })).resolves.toBe(0);
    await expect(prisma.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } })).resolves.toMatchObject({
      status: "APPROVED"
    });
  });

  it("converts an approved request into a draft PO through the server action without receiving stock", async () => {
    vi.stubEnv("LAMBENTI_DEV_USER_ROLE", "PURCHASING");
    vi.stubEnv("LAMBENTI_DEV_USER_ID", `${TEST_PREFIX}-buyer`);
    const { request, item, supplier } = await createFixture("APPROVED");
    await prisma.item.update({ where: { id: item.id }, data: { estimatedUnitCost: 1.5 } });

    await convertApprovedPurchaseRequestAction(formDataFor(request.id, { comment: "Ready to draft PO." }));

    await expect(prisma.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } })).resolves.toMatchObject({
      status: "CONVERTED"
    });
    const order = await prisma.purchaseOrder.findFirstOrThrow({
      where: { purchaseRequestId: request.id },
      include: { lines: true }
    });
    expect(order).toMatchObject({ supplierId: supplier.id, status: "DRAFT" });
    expect(order.lines).toHaveLength(1);
    expect(Number(order.lines[0].unitPrice)).toBe(1.5);
    await expect(prisma.stockMovement.count({ where: { itemId: item.id } })).resolves.toBe(0);
    await expect(prisma.auditLog.findFirstOrThrow({ where: { entityId: request.id, action: "CONVERT_PURCHASE_REQUEST_TO_DRAFT_PO" } })).resolves.toMatchObject({
      actorId: `${TEST_PREFIX}-buyer`
    });
  });
});
