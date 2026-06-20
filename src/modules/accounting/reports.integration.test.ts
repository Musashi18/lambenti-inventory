import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AccountingDocumentStatus, GLAccountType, InvoiceStatus, ItemCategory, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeInvoiceNumberKey } from "./invoices";
import { formatGstHstCsv, getGstHstExportRows } from "./tax";
import { getLandedCostRows, formatLandedCostCsv, getItemLandedCostIndex } from "./landed-cost";
import { resolveInvoiceLineAccount, upsertGLAccount, upsertGLMapping } from "./gl";

const TEST_PREFIX = "TEST-ACCOUNTING-REPORT";

async function cleanupTestData() {
  const documents = await prisma.accountingDocument.findMany({ where: { originalFileName: { startsWith: TEST_PREFIX } }, select: { id: true } });
  const documentIds = documents.map((document) => document.id);
  if (documentIds.length > 0) await prisma.accountingDocument.deleteMany({ where: { id: { in: documentIds } } });

  const invoices = await prisma.supplierInvoice.findMany({ where: { invoiceNumber: { startsWith: TEST_PREFIX } }, select: { id: true } });
  const invoiceIds = invoices.map((invoice) => invoice.id);
  const accounts = await prisma.gLAccount.findMany({ where: { code: { startsWith: TEST_PREFIX } }, select: { id: true } });
  const accountIds = accounts.map((account) => account.id);
  const suppliers = await prisma.supplier.findMany({ where: { name: { startsWith: TEST_PREFIX } }, select: { id: true } });
  const items = await prisma.item.findMany({ where: { sku: { startsWith: TEST_PREFIX } }, select: { id: true } });
  const supplierIds = suppliers.map((supplier) => supplier.id);
  const itemIds = items.map((item) => item.id);
  const ordersBySupplier = supplierIds.length > 0 ? await prisma.purchaseOrder.findMany({ where: { supplierId: { in: supplierIds } }, select: { id: true } }) : [];
  const ordersByItem = itemIds.length > 0 ? await prisma.purchaseOrderLine.findMany({ where: { itemId: { in: itemIds } }, select: { purchaseOrderId: true } }) : [];
  const orderIds = Array.from(new Set([...ordersBySupplier.map((order) => order.id), ...ordersByItem.map((line) => line.purchaseOrderId)]));

  if (invoiceIds.length > 0) {
    await prisma.supplierInvoicePaymentAllocation.deleteMany({ where: { supplierInvoiceId: { in: invoiceIds } } });
    await prisma.accountingDocument.updateMany({ where: { supplierInvoiceId: { in: invoiceIds } }, data: { supplierInvoiceId: null } });
    await prisma.supplierInvoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.supplierInvoice.deleteMany({ where: { id: { in: invoiceIds } } });
  }
  if (orderIds.length > 0) {
    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: orderIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  }
  if (itemIds.length > 0) {
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockLot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }
  if (supplierIds.length > 0) await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
  await prisma.gLAccountMapping.deleteMany({ where: { glAccountId: { in: accountIds } } });
  if (accountIds.length > 0) await prisma.gLAccount.deleteMany({ where: { id: { in: accountIds } } });
  await prisma.storageLocation.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: TEST_PREFIX } } });
}

async function createInvoiceFixture(suffix: string, input?: { status?: InvoiceStatus; recoverableTax?: number; nonRecoverableTax?: number; includePo?: boolean }) {
  const supplier = await prisma.supplier.create({
    data: {
      name: `${TEST_PREFIX}-${suffix}-SUPPLIER`,
      companyName: `${TEST_PREFIX}-${suffix} Supplier Inc.`,
      taxRegistrationNumber: `${TEST_PREFIX}-${suffix}-GST`,
      confirmedByHuman: true,
      moq: 1,
      leadTimeDays: 7,
      shippingCost: 0,
      reliabilityScore: 0.95
    }
  });
  const location = await prisma.storageLocation.create({ data: { code: `${TEST_PREFIX}-${suffix}-LOC`, name: `${TEST_PREFIX} ${suffix}` } });
  const firstItem = await prisma.item.create({
    data: {
      sku: `${TEST_PREFIX}-${suffix}-A`,
      description: `${TEST_PREFIX} line A`,
      category: ItemCategory.COMPONENT,
      unit: Unit.EACH,
      reorderPoint: 0,
      targetStock: 0,
      leadTimeDays: 0,
      storageLocationId: location.id
    }
  });
  const secondItem = await prisma.item.create({
    data: {
      sku: `${TEST_PREFIX}-${suffix}-B`,
      description: `${TEST_PREFIX} line B`,
      category: ItemCategory.RAW_MATERIAL,
      unit: Unit.EACH,
      reorderPoint: 0,
      targetStock: 0,
      leadTimeDays: 0,
      storageLocationId: location.id
    }
  });
  const order = input?.includePo === false ? null : await prisma.purchaseOrder.create({
    data: {
      supplierId: supplier.id,
      status: "ORDERED",
      orderedAt: new Date("2026-06-01T00:00:00.000Z"),
      lines: {
        create: [
          { itemId: firstItem.id, quantity: 2, unitPrice: 30 },
          { itemId: secondItem.id, quantity: 1, unitPrice: 40 }
        ]
      }
    },
    include: { lines: { orderBy: { id: "asc" } } }
  });
  const invoiceNumber = `${TEST_PREFIX}-${suffix}-INV`;
  const invoice = await prisma.supplierInvoice.create({
    data: {
      invoiceNumber,
      invoiceNumberKey: normalizeInvoiceNumberKey(invoiceNumber),
      supplierId: supplier.id,
      purchaseOrderId: order?.id,
      status: input?.status ?? InvoiceStatus.RECEIVED,
      currency: "USD",
      subtotal: 100,
      shippingCost: 20,
      taxCost: 5,
      taxJurisdiction: "CA-ON",
      taxRate: 0.13,
      taxRecoverableAmount: input?.recoverableTax ?? 5,
      taxNonRecoverableAmount: input?.nonRecoverableTax ?? 0,
      dutyCost: 6,
      brokerageCost: 4,
      otherLandedCost: 0,
      total: 135,
      invoiceDate: new Date("2026-06-10T00:00:00.000Z"),
      sourceDocumentPath: `var/accounting-documents/${invoiceNumber}.pdf`,
      sourceDocumentHash: `${TEST_PREFIX}-${suffix}-HASH`,
      lines: {
        create: [
          { itemId: firstItem.id, purchaseOrderLineId: order?.lines[0]?.id, description: firstItem.sku, quantity: 2, unitPrice: 30, lineTotal: 60 },
          { itemId: secondItem.id, purchaseOrderLineId: order?.lines[1]?.id, description: secondItem.sku, quantity: 1, unitPrice: 40, lineTotal: 40 }
        ]
      }
    },
    include: { lines: { include: { item: true }, orderBy: { description: "asc" } }, supplier: true }
  });
  return { supplier, firstItem, secondItem, invoice, order };
}

describe("accounting GST/HST export, GL mapping, and landed-cost reporting", () => {
  beforeEach(cleanupTestData);
  afterAll(cleanupTestData);

  it("exports date-bounded GST/HST support rows without mutating invoice state", async () => {
    const { invoice } = await createInvoiceFixture("GST");
    await createInvoiceFixture("VOID", { status: InvoiceStatus.VOID });

    const rows = await getGstHstExportRows({ from: new Date("2026-06-01T00:00:00.000Z"), to: new Date("2026-06-30T23:59:59.999Z") });
    const row = rows.find((candidate) => candidate.invoiceNumber === invoice.invoiceNumber);
    const csv = formatGstHstCsv(rows);

    expect(row).toMatchObject({
      supplierName: invoice.supplier.companyName,
      supplierTaxRegistrationNumber: `${TEST_PREFIX}-GST-GST`,
      invoiceNumber: invoice.invoiceNumber,
      currency: "USD",
      subtotal: 100,
      gstHstRecoverable: 5,
      gstHstNonRecoverable: 0,
      total: 135,
      sourceDocumentHash: `${TEST_PREFIX}-GST-HASH`
    });
    expect(rows.some((candidate) => candidate.invoiceNumber === `${TEST_PREFIX}-VOID-INV`)).toBe(false);
    expect(csv).toContain("invoiceNumber,supplierName");
    expect(csv).toContain(invoice.invoiceNumber);
    await expect(prisma.supplierInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).resolves.toMatchObject({ status: InvoiceStatus.RECEIVED });
  });

  it("resolves GL account mappings by line override, item, category, then default", async () => {
    const { invoice, firstItem, secondItem } = await createInvoiceFixture("GL");
    const inventory = await upsertGLAccount({ code: `${TEST_PREFIX}-1300`, name: "Inventory", type: GLAccountType.ASSET, actorId: `${TEST_PREFIX}-actor` });
    const rawMaterials = await upsertGLAccount({ code: `${TEST_PREFIX}-1310`, name: "Raw materials", type: GLAccountType.ASSET, actorId: `${TEST_PREFIX}-actor` });
    const fallback = await upsertGLAccount({ code: `${TEST_PREFIX}-5999`, name: "Unmapped expense", type: GLAccountType.EXPENSE, actorId: `${TEST_PREFIX}-actor` });
    await upsertGLMapping({ scopeType: "ITEM", scopeId: firstItem.id, purpose: "INVENTORY_ASSET", glAccountId: inventory.id, actorId: `${TEST_PREFIX}-actor` });
    await upsertGLMapping({ scopeType: "ITEM_CATEGORY", scopeId: ItemCategory.RAW_MATERIAL, purpose: "INVENTORY_ASSET", glAccountId: rawMaterials.id, actorId: `${TEST_PREFIX}-actor` });
    await upsertGLMapping({ scopeType: "DEFAULT", purpose: "INVENTORY_ASSET", glAccountId: fallback.id, actorId: `${TEST_PREFIX}-actor` });

    const firstResolved = await resolveInvoiceLineAccount(invoice.lines.find((line) => line.itemId === firstItem.id)!.id, "INVENTORY_ASSET");
    const secondResolved = await resolveInvoiceLineAccount(invoice.lines.find((line) => line.itemId === secondItem.id)!.id, "INVENTORY_ASSET");

    expect(firstResolved?.code).toBe(`${TEST_PREFIX}-1300`);
    expect(secondResolved?.code).toBe(`${TEST_PREFIX}-1310`);
  });

  it("reports landed-cost allocations while excluding recoverable GST/HST from inventory cost", async () => {
    const { invoice, firstItem } = await createInvoiceFixture("LANDED", { recoverableTax: 5, nonRecoverableTax: 2 });
    await prisma.accountingDocument.create({
      data: {
        source: "TEST",
        sourceKind: "PDF",
        originalFileName: `${TEST_PREFIX}-LANDED-CUSTOMS.pdf`,
        storedPath: `var/accounting-documents/${TEST_PREFIX}-LANDED-CUSTOMS.pdf`,
        sha256: `${TEST_PREFIX}-LANDED-CUSTOMS-HASH`,
        mimeType: "application/pdf",
        sizeBytes: 1024,
        extractedText: "Payment Receipt\nWe have charged 80.74 CAD to your account.\nCanada Customs FEE AMOUNT (CAD) CUSTOMS DUTIES 24.63 FedEx Clearance Service Fees 43.23 TOTAL 80.74",
        analysisJson: {
          schemaVersion: "accounting-document-v1",
          classification: "PAYMENT_RECEIPT",
          direction: "AP",
          currency: "CAD",
          lineCount: 0,
          lines: [],
          confidence: "MEDIUM",
          requiredReview: [],
          suggestedActions: [],
          sourceDocumentRequirements: [],
          canadianAccountingNotes: [],
          duplicateKeys: []
        },
        status: AccountingDocumentStatus.ATTACHED,
        supplierId: invoice.supplierId,
        purchaseOrderId: invoice.purchaseOrderId,
        supplierInvoiceId: invoice.id
      }
    });
    const stockMovementCountBefore = await prisma.stockMovement.count();

    const rows = await getLandedCostRows({ from: new Date("2026-06-01T00:00:00.000Z"), to: new Date("2026-06-30T23:59:59.999Z") });
    const invoiceRows = rows.filter((row) => row.invoiceNumber === invoice.invoiceNumber);
    const csv = formatLandedCostCsv(invoiceRows);

    expect(invoiceRows).toHaveLength(2);
    const allocatedShipping = invoiceRows.reduce((total, row) => total + row.allocatedFreight, 0);
    const allocatedDuty = invoiceRows.reduce((total, row) => total + row.allocatedDuty, 0);
    const allocatedBrokerage = invoiceRows.reduce((total, row) => total + row.allocatedBrokerage, 0);
    const allocatedNonRecoverableTax = invoiceRows.reduce((total, row) => total + row.allocatedNonRecoverableTax, 0);
    const allocatedAttachedEvidence = invoiceRows.reduce((total, row) => total + row.allocatedAttachedLandedCostEvidence, 0);
    const landedTotal = invoiceRows.reduce((total, row) => total + row.landedTotal, 0);
    const recoverableExcluded = invoiceRows.reduce((total, row) => total + row.recoverableTaxExcluded, 0);

    expect(allocatedShipping).toBeCloseTo(20, 2);
    expect(allocatedDuty).toBeCloseTo(6, 2);
    expect(allocatedBrokerage).toBeCloseTo(4, 2);
    expect(allocatedNonRecoverableTax).toBeCloseTo(2, 2);
    expect(allocatedAttachedEvidence).toBeCloseTo(60.55, 2);
    expect(landedTotal).toBeCloseTo(192.55, 2);
    expect(invoiceRows[0].attachedLandedCostEvidenceRefs.join(" ")).toContain("LANDED-CUSTOMS");
    const itemCostIndex = await getItemLandedCostIndex({ from: new Date("2026-06-01T00:00:00.000Z"), to: new Date("2026-06-30T23:59:59.999Z") });
    expect(itemCostIndex.get(firstItem.id)?.landedUnitCost).toBeCloseTo(invoiceRows.find((row) => row.itemId === firstItem.id)!.landedUnitCost, 4);
    expect(recoverableExcluded).toBeCloseTo(5, 2);
    expect(csv).toContain("allocatedAttachedLandedCostEvidence");
    await expect(prisma.stockMovement.count()).resolves.toBe(stockMovementCountBefore);
  });
});
