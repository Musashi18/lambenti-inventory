import { InvoiceStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { summarizeInvoiceDuplicateClusters, summarizeInvoiceWorkQueue } from "./invoices";

describe("supplier invoice work queue summary", () => {
  it("surfaces approval readiness, missing evidence, due-date warnings, and payment queue rows", () => {
    const summary = summarizeInvoiceWorkQueue([
      {
        id: "missing-evidence",
        invoiceNumber: "INV-MISSING",
        status: InvoiceStatus.RECEIVED,
        currency: "USD",
        total: 100,
        dueDate: null,
        invoiceDate: new Date("2026-06-01T00:00:00.000Z"),
        supplier: { name: "Missing Evidence Co" },
        accountingDocuments: [],
        paymentAllocations: [],
        journalEntries: []
      },
      {
        id: "ready",
        invoiceNumber: "INV-READY",
        status: InvoiceStatus.RECEIVED,
        currency: "USD",
        total: 50,
        dueDate: new Date("2026-06-18T00:00:00.000Z"),
        invoiceDate: new Date("2026-06-02T00:00:00.000Z"),
        supplier: { name: "Ready Co" },
        sourceDocumentHash: "hash-ready",
        accountingDocuments: [{ id: "doc-ready" }],
        paymentAllocations: [],
        journalEntries: []
      },
      {
        id: "approved",
        invoiceNumber: "INV-APPROVED",
        status: InvoiceStatus.APPROVED,
        currency: "USD",
        total: 80,
        dueDate: new Date("2026-06-14T00:00:00.000Z"),
        invoiceDate: new Date("2026-06-03T00:00:00.000Z"),
        supplier: { name: "Approved Co" },
        accountingDocuments: [{ id: "doc-approved" }],
        paymentAllocations: [{ amount: 20 }],
        journalEntries: [{ id: "journal-approved" }]
      },
      {
        id: "paid",
        invoiceNumber: "INV-PAID",
        status: InvoiceStatus.PAID,
        currency: "USD",
        total: 25,
        dueDate: null,
        invoiceDate: new Date("2026-06-04T00:00:00.000Z"),
        supplier: { name: "Paid Co" },
        accountingDocuments: [],
        paymentAllocations: [{ amount: 25 }],
        journalEntries: []
      }
    ], new Date("2026-06-15T12:00:00.000Z"));

    expect(summary.openCount).toBe(3);
    expect(summary.receivedCount).toBe(2);
    expect(summary.approvalReadyCount).toBe(1);
    expect(summary.approvalBlockedCount).toBe(1);
    expect(summary.missingEvidenceCount).toBe(1);
    expect(summary.missingDueDateCount).toBe(1);
    expect(summary.approvedAwaitingPaymentCount).toBe(1);
    expect(summary.paidCount).toBe(1);
    expect(summary.openTotal).toBe(210);
    expect(summary.approvalQueue.map((row) => row.id)).toEqual(["ready", "missing-evidence"]);
    expect(summary.approvalReadyQueue.map((row) => row.id)).toEqual(["ready"]);
    expect(summary.approvalBlockedQueue.map((row) => row.id)).toEqual(["missing-evidence"]);
    expect(summary.approvalQueue.find((row) => row.id === "missing-evidence")?.warnings).toEqual(["No source evidence bundle", "Due date not set"]);
    expect(summary.paymentQueue[0]).toMatchObject({ id: "approved", openBalance: 60, dueLabel: "1d overdue", nextAction: "Reconcile payment evidence" });
  });

  it("summarizes duplicate invoice clusters without treating void invoices as active risk", () => {
    const clusters = summarizeInvoiceDuplicateClusters([
      {
        id: "oldest",
        invoiceNumber: "INV-001",
        supplierId: "supplier-1",
        supplier: { name: "Supplier One" },
        purchaseOrderId: "po-1",
        status: InvoiceStatus.RECEIVED,
        currency: "USD",
        total: 145.5,
        createdAt: new Date("2026-06-01T00:00:00.000Z"),
        paymentAllocations: [],
        journalEntries: [],
        accountingDocuments: []
      },
      {
        id: "newer",
        invoiceNumber: "INV-001-copy",
        supplierId: "supplier-1",
        supplier: { name: "Supplier One" },
        purchaseOrderId: "po-1",
        status: InvoiceStatus.RECEIVED,
        currency: "USD",
        total: 145.5,
        createdAt: new Date("2026-06-02T00:00:00.000Z"),
        paymentAllocations: [],
        journalEntries: [],
        accountingDocuments: []
      },
      {
        id: "voided",
        invoiceNumber: "INV-001-void",
        supplierId: "supplier-1",
        supplier: { name: "Supplier One" },
        purchaseOrderId: "po-1",
        status: InvoiceStatus.VOID,
        currency: "USD",
        total: 145.5,
        createdAt: new Date("2026-06-03T00:00:00.000Z")
      }
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({
      canonicalInvoiceId: "oldest",
      duplicateInvoiceIds: ["newer"],
      duplicateCount: 1,
      amountAtRisk: 145.5,
      canVoidDuplicates: true
    });
  });
});
