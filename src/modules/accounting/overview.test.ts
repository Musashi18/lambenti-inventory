import { InvoiceStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { summarizeBankReconciliation, summarizePayablesAging, summarizePostingGlSetup } from "./overview";

describe("accounting command-center summaries", () => {
  it("splits open payables into overdue, due-soon, later, and no-due-date buckets", () => {
    const summary = summarizePayablesAging([
      {
        id: "overdue",
        invoiceNumber: "INV-OVERDUE",
        status: InvoiceStatus.RECEIVED,
        currency: "USD",
        total: 100,
        dueDate: new Date("2026-06-10T12:00:00.000Z"),
        invoiceDate: new Date("2026-06-01T00:00:00.000Z"),
        supplier: { name: "Overdue Supplier" },
        paymentAllocations: [{ amount: 20 }],
        accountingDocuments: [{ id: "doc-1" }]
      },
      {
        id: "soon",
        invoiceNumber: "INV-SOON",
        status: InvoiceStatus.APPROVED,
        currency: "USD",
        total: 50,
        dueDate: new Date("2026-06-20T00:00:00.000Z"),
        invoiceDate: new Date("2026-06-02T00:00:00.000Z"),
        supplier: { name: "Soon Supplier" },
        paymentAllocations: [],
        accountingDocuments: []
      },
      {
        id: "later",
        invoiceNumber: "INV-LATER",
        status: InvoiceStatus.RECEIVED,
        currency: "USD",
        total: 200,
        dueDate: new Date("2026-07-15T00:00:00.000Z"),
        invoiceDate: new Date("2026-06-03T00:00:00.000Z"),
        supplier: { name: "Later Supplier" },
        paymentAllocations: [],
        accountingDocuments: []
      },
      {
        id: "no-date",
        invoiceNumber: "INV-NO-DATE",
        status: InvoiceStatus.RECEIVED,
        currency: "USD",
        total: 25,
        dueDate: null,
        invoiceDate: new Date("2026-06-04T00:00:00.000Z"),
        supplier: { name: "No Date Supplier" },
        paymentAllocations: [],
        accountingDocuments: []
      }
    ], new Date("2026-06-15T18:00:00.000Z"));

    expect(summary.openCount).toBe(4);
    expect(summary.openTotal).toBe(355);
    expect(summary.receivedCount).toBe(3);
    expect(summary.approvedCount).toBe(1);
    expect(summary.overdue).toEqual({ count: 1, total: 80 });
    expect(summary.dueNext7Days).toEqual({ count: 1, total: 50 });
    expect(summary.later).toEqual({ count: 1, total: 200 });
    expect(summary.noDueDate).toEqual({ count: 1, total: 25 });
    expect(summary.nextDueInvoices.map((invoice) => invoice.id)).toEqual(["overdue", "soon", "no-date", "later"]);
    expect(summary.nextDueInvoices[0]).toMatchObject({ dueLabel: "5d overdue", openBalance: 80, evidenceCount: 1 });
  });

  it("summarizes unmatched bank transactions without posting or matching them", () => {
    const summary = summarizeBankReconciliation([
      { id: "old", currency: "USD", amount: -7.5, postedAt: new Date("2026-06-01T00:00:00.000Z"), reference: "OLD", description: "Older fee" },
      { id: "out", currency: "USD", amount: -100, postedAt: new Date("2026-06-15T00:00:00.000Z"), reference: "WIRE-001", description: "Supplier payment" },
      { id: "in", currency: "USD", amount: 25, postedAt: new Date("2026-06-16T00:00:00.000Z"), reference: "REFUND-001", description: "Refund" }
    ]);

    expect(summary.unmatchedCount).toBe(3);
    expect(summary.outgoingTotal).toBe(107.5);
    expect(summary.incomingTotal).toBe(25);
    expect(summary.latestTransactions.map((transaction) => transaction.id)).toEqual(["in", "out", "old"]);
  });

  it("reports missing default GL mappings before invoice approval/payment posting", () => {
    const summary = summarizePostingGlSetup([
      { purpose: "INVENTORY_ASSET", active: true, scopeType: "DEFAULT", scopeId: null, glAccount: { active: true, code: "1300", name: "Inventory" } },
      { purpose: "TAX_RECOVERABLE", active: false, scopeType: "DEFAULT", scopeId: null, glAccount: { active: true, code: "1060", name: "Tax recoverable" } },
      { purpose: "BANK_CASH", active: true, scopeType: "SUPPLIER", scopeId: "supplier-id", glAccount: { active: true, code: "1000", name: "Bank" } }
    ]);

    expect(summary.configuredPurposes).toEqual(["INVENTORY_ASSET"]);
    expect(summary.missingPurposes).toEqual(["TAX_RECOVERABLE", "ACCOUNTS_PAYABLE", "BANK_CASH"]);
    expect(summary.readyForPosting).toBe(false);
  });
});
