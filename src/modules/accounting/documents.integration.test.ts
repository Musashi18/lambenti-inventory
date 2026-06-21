import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AccountingDocumentStatus, InvoiceStatus, ItemCategory, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  applyAccountingDocumentAnalysis,
  analyzeAccountingDocumentText,
  attachAccountingDocumentEvidence,
  deleteAccountingDocumentSource,
  ingestAccountingDocumentUpload,
  retryAccountingDocumentExtraction,
  updateAccountingDocumentExtractedText
} from "./documents";

const TEST_PREFIX = "TEST-ACCOUNTING-DOC";
const accountingActor = {
  id: `${TEST_PREFIX}-accountant`,
  role: "ACCOUNTING" as const,
  type: "HUMAN" as const,
  actorType: "USER" as const
};

function uploadFile(name: string, type: string, text: string) {
  const buffer = Buffer.from(text, "utf8");
  return {
    name,
    type,
    size: buffer.length,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  };
}

async function cleanupTestData() {
  const documents = await prisma.accountingDocument.findMany({
    where: { originalFileName: { startsWith: TEST_PREFIX } },
    select: { id: true, supplierInvoiceId: true, purchaseOrderId: true }
  });
  const documentIds = documents.map((document) => document.id);
  const invoiceIds = documents.map((document) => document.supplierInvoiceId).filter((id): id is string => Boolean(id));
  const documentOrderIds = documents.map((document) => document.purchaseOrderId).filter((id): id is string => Boolean(id));
  const invoices = await prisma.supplierInvoice.findMany({
    where: { OR: [{ invoiceNumber: { startsWith: TEST_PREFIX } }, { id: { in: invoiceIds } }] },
    select: { id: true, purchaseOrderId: true }
  });
  const allInvoiceIds = Array.from(new Set([...invoiceIds, ...invoices.map((invoice) => invoice.id)]));
  const items = await prisma.item.findMany({ where: { sku: { startsWith: TEST_PREFIX } }, select: { id: true } });
  const suppliers = await prisma.supplier.findMany({ where: { name: { startsWith: TEST_PREFIX } }, select: { id: true } });
  const supplierIds = suppliers.map((supplier) => supplier.id);
  const itemIds = items.map((item) => item.id);
  const ordersBySupplier = supplierIds.length > 0
    ? await prisma.purchaseOrder.findMany({ where: { supplierId: { in: supplierIds } }, select: { id: true } })
    : [];
  const ordersByItem = itemIds.length > 0
    ? await prisma.purchaseOrderLine.findMany({ where: { itemId: { in: itemIds } }, select: { purchaseOrderId: true } })
    : [];
  const orderIds = Array.from(new Set([
    ...documentOrderIds,
    ...invoices.map((invoice) => invoice.purchaseOrderId).filter((id): id is string => Boolean(id)),
    ...ordersBySupplier.map((order) => order.id),
    ...ordersByItem.map((line) => line.purchaseOrderId)
  ]));

  if (documentIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityType: "AccountingDocument", entityId: { in: documentIds } } });
    await prisma.accountingDocument.deleteMany({ where: { id: { in: documentIds } } });
  }
  if (allInvoiceIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityType: "SupplierInvoice", entityId: { in: allInvoiceIds } } });
    await prisma.supplierInvoiceLine.deleteMany({ where: { invoiceId: { in: allInvoiceIds } } });
    await prisma.supplierInvoice.deleteMany({ where: { id: { in: allInvoiceIds } } });
  }
  if (orderIds.length > 0) {
    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: orderIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  }
  if (itemIds.length > 0) {
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockLot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.purchaseOrderLine.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }
  if (supplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
  }
  await prisma.storageLocation.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: TEST_PREFIX } } });
}

async function createPurchaseOrderFixture(suffix: string) {
  const location = await prisma.storageLocation.create({
    data: { code: `${TEST_PREFIX}-${suffix}-LOC`, name: `Accounting document ${suffix}` }
  });
  const supplier = await prisma.supplier.create({
    data: {
      name: `${TEST_PREFIX}-${suffix}-SUPPLIER`,
      companyName: `${TEST_PREFIX}-${suffix} Supplier Inc.`,
      confirmedByHuman: true,
      moq: 1,
      leadTimeDays: 7,
      shippingCost: 3,
      reliabilityScore: 0.95
    }
  });
  const item = await prisma.item.create({
    data: {
      sku: `${TEST_PREFIX}-${suffix}-ITEM`,
      description: `Accounting document test item ${suffix}`,
      category: ItemCategory.COMPONENT,
      unit: Unit.EACH,
      reorderPoint: 0,
      targetStock: 0,
      leadTimeDays: 0,
      storageLocationId: location.id
    }
  });
  const order = await prisma.purchaseOrder.create({
    data: {
      supplierId: supplier.id,
      status: "ORDERED",
      orderedAt: new Date("2026-06-01T00:00:00.000Z"),
      lines: {
        create: [{ itemId: item.id, quantity: 5, unitPrice: 2.4 }]
      }
    },
    include: { lines: true }
  });
  return { supplier, item, order, line: order.lines[0] };
}

function invoiceText(suffix: string, supplierName: string, itemSku: string) {
  return [
    `Subject: Supplier invoice ${TEST_PREFIX}-${suffix}-INV`,
    "From: ap@example-supplier.test",
    `Supplier: ${supplierName}`,
    `Invoice number: ${TEST_PREFIX}-${suffix}-INV`,
    `Order ID: ${TEST_PREFIX}-${suffix}-ORDER`,
    "Invoice date: 2026-06-08",
    "Due date: 2026-06-22",
    `SKU: ${itemSku}`,
    "Description: Lambenti accounting document test component",
    "Quantity: 5",
    "Unit price: USD 2.40",
    "Subtotal USD 12.00",
    "Shipping USD 3.00",
    "GST/HST USD 0.00",
    "Total USD 15.00"
  ].join("\n");
}

function paymentReceiptText(suffix: string, supplierName: string) {
  return [
    `Subject: Payment receipt ${TEST_PREFIX}-${suffix}-PAYMENT`,
    "From: payments@example-supplier.test",
    `Supplier: ${supplierName}`,
    `Invoice number: ${TEST_PREFIX}-${suffix}-INV`,
    "Payment receipt",
    "Payment status: Paid",
    "Full payment (USD 15.00)",
    "Payment reference: WIRE-TEST-001",
    "Paid on 2026-06-10"
  ].join("\n");
}

describe("accounting document ingestion and invoice application", () => {
  beforeEach(cleanupTestData);
  afterAll(cleanupTestData);

  it("extracts useful fields from OCR pro forma invoices without inventing an invoice number from the title", async () => {
    const analysis = await analyzeAccountingDocumentText({
      text: [
        "Proforma Invoice",
        "From (Shipper) To (Receiver)",
        "AF BFConpany name: Huizhou Shengye [Mi PF Arecipient: Musashi Kaneko",
        "Electronics Co., Lod:",
        "Phone: 0762-3125855",
        "DescriptionofGoods QTY Unitvalue Total Value USD",
        "Plastic Nylon Cable Organizer Product Quantity: 2500",
        "Total Value/ HA1USD:",
        "1. Delivery period: within 7 days after receiving payment",
        "3. Required documents: invoice and packing list",
        "Signature & DATE June 9 2026"
      ].join("\n"),
      originalFileName: `${TEST_PREFIX}-PROFORMA.png`,
      sha256: `${TEST_PREFIX}-PROFORMA-HASH`
    });

    expect(analysis).toMatchObject({
      classification: "QUOTE_OR_PRO_FORMA",
      supplierName: "Huizhou Shengye Electronics Co., Ltd",
      invoiceNumber: undefined,
      currency: "USD",
      shippingCost: undefined,
      total: undefined
    });
  });

  it("treats Alibaba paid order OCR as payment evidence and prefers full payment totals over noisy product quantities", async () => {
    const analysis = await analyzeAccountingDocumentText({
      text: [
        "Product details",
        "Sold by: Huizhou Shengye Electronics Co., Ltd. Z] Chat now",
        "Product Quantity: 2500.00 Total Price: USD 50.00",
        "Shipment details Waiting for supplier to ship",
        "Payment details",
        "Payment status Summary",
        "Full payment (USD 145.50) Item subtotal USD 50.00",
        "Credit/debit card Shipping fee USD 95.50",
        "Paid on 2026-06-08 18:31:58",
        "Subtotal USD 145.50",
        "supplier details Supplier Contact Name Company phone Company email",
        "Huizhou Shengye Winnie XU shengyehz@163.com"
      ].join("\n"),
      originalFileName: `${TEST_PREFIX}-ALIBABA-ORDER.pdf`,
      sha256: `${TEST_PREFIX}-ALIBABA-ORDER-HASH`
    });

    expect(analysis).toMatchObject({
      classification: "PAYMENT_RECEIPT",
      direction: "AP",
      supplierName: "Huizhou Shengye Electronics Co., Ltd",
      currency: "USD",
      subtotal: 50,
      shippingCost: 95.5,
      total: 145.5
    });
  });

  it("classifies customs payment receipts and reads number-then-currency charged totals", async () => {
    const analysis = await analyzeAccountingDocumentText({
      text: [
        "Payment Receipt / Reçu du paiement",
        "Please be advised that your payment transaction was successful.",
        "We have charged",
        "80.74 CAD to your account and it will be applied as follows:",
        "Canada Customs FEE AMOUNT (CAD)",
        "Fees CUSTOMS DUTIES 24.63",
        "FedEx Clearance Service Fees SPECIAL ASSESSMENT 43.23",
        "TOTAL 80.74"
      ].join("\n"),
      originalFileName: "PaymentReceipt.pdf",
      sha256: `${TEST_PREFIX}-CUSTOMS-RECEIPT-HASH`
    });

    expect(analysis).toMatchObject({
      classification: "CUSTOMS_DOCUMENT",
      currency: "CAD",
      total: 80.74
    });
  });

  it("saves an uploaded source document, extracts accounting fields, and does not create operational records during analysis", async () => {
    const { supplier, item } = await createPurchaseOrderFixture("ANALYZE");
    const supplierCountBefore = await prisma.supplier.count({ where: { name: { startsWith: TEST_PREFIX } } });
    const invoiceCountBefore = await prisma.supplierInvoice.count({ where: { invoiceNumber: { startsWith: TEST_PREFIX } } });
    const stockMovementCountBefore = await prisma.stockMovement.count({ where: { itemId: item.id } });

    const result = await ingestAccountingDocumentUpload({
      file: uploadFile(`${TEST_PREFIX}-ANALYZE.txt`, "text/plain", invoiceText("ANALYZE", supplier.name, item.sku)),
      actorId: accountingActor.id
    });

    expect(result.duplicate).toBe(false);
    expect(result.document).toMatchObject({
      originalFileName: `${TEST_PREFIX}-ANALYZE.txt`,
      mimeType: "text/plain",
      status: AccountingDocumentStatus.ANALYZED,
      supplierId: supplier.id
    });
    expect(result.analysis).toMatchObject({
      classification: "SUPPLIER_INVOICE",
      direction: "AP",
      supplierName: supplier.name,
      invoiceNumber: `${TEST_PREFIX}-ANALYZE-INV`,
      currency: "USD",
      subtotal: 12,
      shippingCost: 3,
      taxCost: 0,
      total: 15
    });

    await expect(prisma.supplier.count({ where: { name: { startsWith: TEST_PREFIX } } })).resolves.toBe(supplierCountBefore);
    await expect(prisma.supplierInvoice.count({ where: { invoiceNumber: { startsWith: TEST_PREFIX } } })).resolves.toBe(invoiceCountBefore);
    await expect(prisma.stockMovement.count({ where: { itemId: item.id } })).resolves.toBe(stockMovementCountBefore);
  });

  it("dedupes repeated uploads by source hash instead of creating duplicate accounting documents", async () => {
    const { supplier, item } = await createPurchaseOrderFixture("DEDUPE");
    const fileText = invoiceText("DEDUPE", supplier.name, item.sku);

    const first = await ingestAccountingDocumentUpload({
      file: uploadFile(`${TEST_PREFIX}-DEDUPE.txt`, "text/plain", fileText),
      actorId: accountingActor.id
    });
    const second = await ingestAccountingDocumentUpload({
      file: uploadFile(`${TEST_PREFIX}-DEDUPE-copy.txt`, "text/plain", fileText),
      actorId: accountingActor.id
    });

    expect(second.duplicate).toBe(true);
    expect(second.document.id).toBe(first.document.id);
    await expect(prisma.accountingDocument.count({ where: { sha256: first.document.sha256 } })).resolves.toBe(1);
  });

  it("deletes unattached accounting source documents without invoice or stock side effects", async () => {
    const { supplier, item } = await createPurchaseOrderFixture("DELETE");
    const document = await ingestAccountingDocumentUpload({
      file: uploadFile(`${TEST_PREFIX}-DELETE.txt`, "text/plain", invoiceText("DELETE", supplier.name, item.sku)),
      actorId: accountingActor.id
    });
    const invoiceCountBefore = await prisma.supplierInvoice.count({ where: { invoiceNumber: { startsWith: TEST_PREFIX } } });
    const stockMovementCountBefore = await prisma.stockMovement.count({ where: { itemId: item.id } });

    const deleted = await deleteAccountingDocumentSource({
      documentId: document.document.id,
      actor: accountingActor
    });

    expect(deleted).toMatchObject({
      id: document.document.id,
      originalFileName: `${TEST_PREFIX}-DELETE.txt`
    });
    await expect(prisma.accountingDocument.count({ where: { id: document.document.id } })).resolves.toBe(0);
    await expect(prisma.supplierInvoice.count({ where: { invoiceNumber: { startsWith: TEST_PREFIX } } })).resolves.toBe(invoiceCountBefore);
    await expect(prisma.stockMovement.count({ where: { itemId: item.id } })).resolves.toBe(stockMovementCountBefore);
    await expect(prisma.auditLog.count({
      where: { entityId: document.document.id, entityType: "AccountingDocument", action: "DELETE_ACCOUNTING_DOCUMENT_SOURCE" }
    })).resolves.toBe(1);
  });

  it("rejects deleting accounting documents already applied to operational evidence", async () => {
    const { supplier, item, order } = await createPurchaseOrderFixture("DELETEAPPLIED");
    const document = await ingestAccountingDocumentUpload({
      file: uploadFile(`${TEST_PREFIX}-DELETEAPPLIED.txt`, "text/plain", invoiceText("DELETEAPPLIED", supplier.name, item.sku)),
      actorId: accountingActor.id
    });
    const applied = await applyAccountingDocumentAnalysis({
      documentId: document.document.id,
      purchaseOrderId: order.id,
      actor: accountingActor
    });
    const stockMovementCountBefore = await prisma.stockMovement.count({ where: { itemId: item.id } });

    await expect(deleteAccountingDocumentSource({
      documentId: applied.document.id,
      actor: accountingActor
    })).rejects.toThrow(/attached or applied accounting documents/i);

    await expect(prisma.accountingDocument.count({ where: { id: applied.document.id } })).resolves.toBe(1);
    await expect(prisma.stockMovement.count({ where: { itemId: item.id } })).resolves.toBe(stockMovementCountBefore);
  });

  it("locks retry OCR and manual text edits once a source document is attached to accounting evidence", async () => {
    const { supplier, item, order } = await createPurchaseOrderFixture("RETRYLOCKED");
    const document = await ingestAccountingDocumentUpload({
      file: uploadFile(`${TEST_PREFIX}-RETRYLOCKED.txt`, "text/plain", invoiceText("RETRYLOCKED", supplier.name, item.sku)),
      actorId: accountingActor.id
    });
    const applied = await applyAccountingDocumentAnalysis({
      documentId: document.document.id,
      purchaseOrderId: order.id,
      actor: accountingActor
    });
    const stockMovementCountBefore = await prisma.stockMovement.count({ where: { itemId: item.id } });
    const before = await prisma.accountingDocument.findUniqueOrThrow({ where: { id: applied.document.id } });

    await expect(retryAccountingDocumentExtraction({
      documentId: applied.document.id,
      actor: accountingActor
    })).rejects.toThrow(/linked accounting evidence cannot be re-analyzed/i);
    await expect(updateAccountingDocumentExtractedText({
      documentId: applied.document.id,
      text: invoiceText("RETRYLOCKED-CHANGED", supplier.name, item.sku),
      actor: accountingActor
    })).rejects.toThrow(/linked accounting evidence cannot be re-analyzed/i);

    const after = await prisma.accountingDocument.findUniqueOrThrow({ where: { id: applied.document.id } });
    expect(after).toMatchObject({
      status: AccountingDocumentStatus.APPLIED,
      supplierInvoiceId: before.supplierInvoiceId,
      extractedText: before.extractedText,
      analysisJson: before.analysisJson
    });
    await expect(prisma.stockMovement.count({ where: { itemId: item.id } })).resolves.toBe(stockMovementCountBefore);
  });

  it("keeps unreadable source documents reviewable and lets an operator paste text for analysis without operational side effects", async () => {
    const { supplier, item } = await createPurchaseOrderFixture("MANUALTEXT");
    const previousOcrDisabled = process.env.LAMBENTI_OCR_DISABLED;
    process.env.LAMBENTI_OCR_DISABLED = "true";

    try {
      const unreadable = await ingestAccountingDocumentUpload({
        file: uploadFile(`${TEST_PREFIX}-MANUALTEXT.png`, "image/png", "not really an image; OCR intentionally disabled"),
        actorId: accountingActor.id
      });
      const supplierCountBefore = await prisma.supplier.count({ where: { name: { startsWith: TEST_PREFIX } } });
      const invoiceCountBefore = await prisma.supplierInvoice.count({ where: { invoiceNumber: { startsWith: TEST_PREFIX } } });
      const stockMovementCountBefore = await prisma.stockMovement.count({ where: { itemId: item.id } });

      expect(unreadable.document).toMatchObject({
        originalFileName: `${TEST_PREFIX}-MANUALTEXT.png`,
        status: AccountingDocumentStatus.NEEDS_REVIEW
      });
      expect(unreadable.document.errorMessage).toContain("Paste extracted text manually");
      expect(unreadable.analysis).toMatchObject({
        classification: "UNKNOWN",
        confidence: "LOW"
      });

      const updated = await updateAccountingDocumentExtractedText({
        documentId: unreadable.document.id,
        text: invoiceText("MANUALTEXT", supplier.name, item.sku),
        actor: accountingActor
      });

      expect(updated.document).toMatchObject({
        status: AccountingDocumentStatus.ANALYZED,
        supplierId: supplier.id,
        errorMessage: null
      });
      expect(updated.analysis).toMatchObject({
        classification: "SUPPLIER_INVOICE",
        supplierName: supplier.name,
        invoiceNumber: `${TEST_PREFIX}-MANUALTEXT-INV`,
        total: 15
      });
      await expect(prisma.supplier.count({ where: { name: { startsWith: TEST_PREFIX } } })).resolves.toBe(supplierCountBefore);
      await expect(prisma.supplierInvoice.count({ where: { invoiceNumber: { startsWith: TEST_PREFIX } } })).resolves.toBe(invoiceCountBefore);
      await expect(prisma.stockMovement.count({ where: { itemId: item.id } })).resolves.toBe(stockMovementCountBefore);
    } finally {
      if (previousOcrDisabled === undefined) delete process.env.LAMBENTI_OCR_DISABLED;
      else process.env.LAMBENTI_OCR_DISABLED = previousOcrDisabled;
    }
  });

  it("suggests an existing invoice evidence bundle by supplier and invoice number", async () => {
    const { supplier, item, order } = await createPurchaseOrderFixture("MATCHINVOICE");
    const invoiceDocument = await ingestAccountingDocumentUpload({
      file: uploadFile(`${TEST_PREFIX}-MATCHINVOICE-invoice.txt`, "text/plain", invoiceText("MATCHINVOICE", supplier.name, item.sku)),
      actorId: accountingActor.id
    });
    const applied = await applyAccountingDocumentAnalysis({
      documentId: invoiceDocument.document.id,
      purchaseOrderId: order.id,
      actor: accountingActor
    });

    const analysis = await analyzeAccountingDocumentText({
      text: paymentReceiptText("MATCHINVOICE", supplier.name),
      originalFileName: `${TEST_PREFIX}-MATCHINVOICE-receipt.txt`,
      sha256: `${TEST_PREFIX}-MATCHINVOICE-RECEIPT-HASH`
    });

    expect(analysis).toMatchObject({
      classification: "PAYMENT_RECEIPT",
      invoiceNumber: `${TEST_PREFIX}-MATCHINVOICE-INV`,
      matchedSupplierInvoiceId: applied.invoice.id
    });
    expect(analysis.suggestedActions[0]).toContain("Attach to the existing supplier invoice evidence bundle");
  });

  it("attaches payment evidence to an invoice bundle without marking paid or receiving stock", async () => {
    const { supplier, item, order, line } = await createPurchaseOrderFixture("BUNDLE");
    const invoiceDocument = await ingestAccountingDocumentUpload({
      file: uploadFile(`${TEST_PREFIX}-BUNDLE-invoice.txt`, "text/plain", invoiceText("BUNDLE", supplier.name, item.sku)),
      actorId: accountingActor.id
    });
    const appliedInvoice = await applyAccountingDocumentAnalysis({
      documentId: invoiceDocument.document.id,
      purchaseOrderId: order.id,
      actor: accountingActor
    });
    const receiptDocument = await ingestAccountingDocumentUpload({
      file: uploadFile(`${TEST_PREFIX}-BUNDLE-receipt.txt`, "text/plain", paymentReceiptText("BUNDLE", supplier.name)),
      actorId: accountingActor.id
    });

    const stockMovementCountBefore = await prisma.stockMovement.count({ where: { itemId: item.id } });
    const attached = await attachAccountingDocumentEvidence({
      documentId: receiptDocument.document.id,
      supplierInvoiceId: appliedInvoice.invoice.id,
      actor: accountingActor
    });

    expect(attached.document).toMatchObject({
      status: AccountingDocumentStatus.ATTACHED,
      supplierInvoiceId: appliedInvoice.invoice.id,
      purchaseOrderId: order.id,
      supplierId: supplier.id
    });
    await expect(prisma.supplierInvoice.findUniqueOrThrow({ where: { id: appliedInvoice.invoice.id } })).resolves.toMatchObject({
      status: InvoiceStatus.RECEIVED,
      paymentReference: null,
      paidAt: null,
      paidBy: null
    });
    await expect(prisma.stockMovement.count({ where: { itemId: item.id } })).resolves.toBe(stockMovementCountBefore);
    await expect(prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: line.id } })).resolves.toMatchObject({ receivedQuantity: 0 });
  });

  it("rejects applying non-invoice accounting documents so payment receipts cannot post AP", async () => {
    const { supplier, item, order } = await createPurchaseOrderFixture("REJECTPAYMENT");
    const receiptDocument = await ingestAccountingDocumentUpload({
      file: uploadFile(`${TEST_PREFIX}-REJECTPAYMENT-receipt.txt`, "text/plain", paymentReceiptText("REJECTPAYMENT", supplier.name)),
      actorId: accountingActor.id
    });
    const invoiceCountBefore = await prisma.supplierInvoice.count({ where: { invoiceNumber: { startsWith: TEST_PREFIX } } });
    const stockMovementCountBefore = await prisma.stockMovement.count({ where: { itemId: item.id } });

    await expect(applyAccountingDocumentAnalysis({
      documentId: receiptDocument.document.id,
      purchaseOrderId: order.id,
      actor: accountingActor
    })).rejects.toThrow(/supplier invoice document/i);

    await expect(prisma.supplierInvoice.count({ where: { invoiceNumber: { startsWith: TEST_PREFIX } } })).resolves.toBe(invoiceCountBefore);
    await expect(prisma.stockMovement.count({ where: { itemId: item.id } })).resolves.toBe(stockMovementCountBefore);
  });

  it("applies a reviewed accounting document to a supplier invoice without receiving stock", async () => {
    const { supplier, item, order, line } = await createPurchaseOrderFixture("APPLY");
    const document = await ingestAccountingDocumentUpload({
      file: uploadFile(`${TEST_PREFIX}-APPLY.txt`, "text/plain", invoiceText("APPLY", supplier.name, item.sku)),
      actorId: accountingActor.id
    });

    const stockMovementCountBefore = await prisma.stockMovement.count({ where: { itemId: item.id } });
    const applied = await applyAccountingDocumentAnalysis({
      documentId: document.document.id,
      purchaseOrderId: order.id,
      actor: accountingActor
    });

    expect(applied.invoice).toMatchObject({
      invoiceNumber: `${TEST_PREFIX}-APPLY-INV`,
      status: InvoiceStatus.RECEIVED,
      supplierId: supplier.id,
      purchaseOrderId: order.id,
      sourceDocumentHash: document.document.sha256,
      sourceDocumentPath: document.document.storedPath
    });
    expect(Number(applied.invoice.subtotal.toString())).toBe(12);
    expect(Number(applied.invoice.shippingCost.toString())).toBe(3);
    expect(Number(applied.invoice.total.toString())).toBe(15);
    expect(applied.document).toMatchObject({
      status: AccountingDocumentStatus.APPLIED,
      supplierInvoiceId: applied.invoice.id,
      purchaseOrderId: order.id,
      supplierId: supplier.id
    });

    await expect(prisma.stockMovement.count({ where: { itemId: item.id } })).resolves.toBe(stockMovementCountBefore);
    await expect(prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: line.id } })).resolves.toMatchObject({ receivedQuantity: 0 });
  });
});
