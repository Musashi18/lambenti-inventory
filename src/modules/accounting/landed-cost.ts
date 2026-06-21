import { AccountingDocumentStatus, InvoiceStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { convertToUsd } from "@/modules/currency";
import { allocateOrderLevelCost } from "@/modules/inventory/unit-cost-engine";
import type { AccountingDateRange } from "./tax";

export type LandedCostRow = {
  invoiceId: string;
  invoiceNumber: string;
  invoiceLineId: string;
  purchaseOrderId?: string;
  purchaseOrderLineId?: string;
  itemId?: string;
  sku?: string;
  description: string;
  quantity: number;
  currency: string;
  lineSubtotal: number;
  allocatedFreight: number;
  allocatedDuty: number;
  allocatedBrokerage: number;
  allocatedNonRecoverableTax: number;
  allocatedOther: number;
  allocatedAttachedLandedCostEvidence: number;
  attachedLandedCostEvidenceRefs: string[];
  recoverableTaxExcluded: number;
  landedTotal: number;
  landedUnitCost: number;
  warnings: string[];
};

export type ItemLandedCostSummary = {
  itemId: string;
  sku?: string;
  landedUnitCost: number;
  totalLandedCost: number;
  quantity: number;
  currency: "USD";
  sourceRefs: string[];
};

export async function getLandedCostRows(range: AccountingDateRange = {}): Promise<LandedCostRow[]> {
  const invoices = await prisma.supplierInvoice.findMany({
    where: {
      status: { not: InvoiceStatus.VOID },
      ...(range.from || range.to
        ? {
          invoiceDate: {
            ...(range.from ? { gte: range.from } : {}),
            ...(range.to ? { lte: range.to } : {})
          }
        }
        : {})
    },
    include: {
      accountingDocuments: true,
      lines: { include: { item: true, purchaseOrderLine: true }, orderBy: { description: "asc" } },
      purchaseOrder: { include: { accountingDocuments: true } }
    },
    orderBy: [{ invoiceDate: "asc" }, { invoiceNumber: "asc" }]
  });

  return invoices.flatMap((invoice) => landedCostRowsForInvoice(invoice));
}

export async function getItemLandedCostIndex(range: AccountingDateRange = {}): Promise<Map<string, ItemLandedCostSummary>> {
  const rows = await getLandedCostRows(range);
  const summaries = new Map<string, ItemLandedCostSummary>();

  for (const row of rows) {
    if (!row.itemId || row.quantity <= 0) continue;
    const current = summaries.get(row.itemId) ?? {
      itemId: row.itemId,
      sku: row.sku,
      landedUnitCost: 0,
      totalLandedCost: 0,
      quantity: 0,
      currency: "USD" as const,
      sourceRefs: []
    };
    current.totalLandedCost = round2(current.totalLandedCost + row.landedTotal);
    current.quantity += row.quantity;
    current.landedUnitCost = current.quantity > 0 ? round4(current.totalLandedCost / current.quantity) : 0;
    for (const ref of [row.invoiceNumber, ...row.attachedLandedCostEvidenceRefs]) {
      if (ref && !current.sourceRefs.includes(ref)) current.sourceRefs.push(ref);
    }
    summaries.set(row.itemId, current);
  }

  return summaries;
}

export function formatLandedCostCsv(rows: LandedCostRow[]) {
  const header = [
    "invoiceNumber",
    "sku",
    "description",
    "quantity",
    "currency",
    "lineSubtotal",
    "allocatedFreight",
    "allocatedDuty",
    "allocatedBrokerage",
    "allocatedNonRecoverableTax",
    "allocatedOther",
    "allocatedAttachedLandedCostEvidence",
    "attachedLandedCostEvidenceRefs",
    "recoverableTaxExcluded",
    "landedTotal",
    "landedUnitCost",
    "purchaseOrderId",
    "purchaseOrderLineId",
    "warnings"
  ];
  return [
    header.join(","),
    ...rows.map((row) => [
      row.invoiceNumber,
      row.sku ?? "",
      row.description,
      row.quantity,
      row.currency,
      money(row.lineSubtotal),
      money(row.allocatedFreight),
      money(row.allocatedDuty),
      money(row.allocatedBrokerage),
      money(row.allocatedNonRecoverableTax),
      money(row.allocatedOther),
      money(row.allocatedAttachedLandedCostEvidence),
      row.attachedLandedCostEvidenceRefs.join(" | "),
      money(row.recoverableTaxExcluded),
      money(row.landedTotal),
      money(row.landedUnitCost),
      row.purchaseOrderId ?? "",
      row.purchaseOrderLineId ?? "",
      row.warnings.join(" | ")
    ].map(csvCell).join(","))
  ].join("\n");
}

type InvoiceForLandedCost = Awaited<ReturnType<typeof prisma.supplierInvoice.findMany>>[number] & {
  accountingDocuments: AccountingDocumentForLandedCost[];
  lines: Array<{
    id: string;
    itemId: string | null;
    purchaseOrderLineId: string | null;
    description: string;
    quantity: number;
    lineTotal: Prisma.Decimal;
    item: { sku: string } | null;
  }>;
  purchaseOrder: { id: string; accountingDocuments: AccountingDocumentForLandedCost[] } | null;
};

type AccountingDocumentForLandedCost = {
  id: string;
  originalFileName: string;
  status: AccountingDocumentStatus;
  extractedText: string | null;
  analysisJson: Prisma.JsonValue | null;
};

function landedCostRowsForInvoice(invoice: InvoiceForLandedCost): LandedCostRow[] {
  const lineSubtotals = invoice.lines.map((line) => decimalNumber(line.lineTotal));
  const subtotal = lineSubtotals.reduce((total, value) => total + value, 0);
  const freight = allocate(decimalNumber(invoice.shippingCost), lineSubtotals);
  const duty = allocate(decimalNumber(invoice.dutyCost), lineSubtotals);
  const brokerage = allocate(decimalNumber(invoice.brokerageCost), lineSubtotals);
  const nonRecoverableTax = allocate(decimalNumber(invoice.taxNonRecoverableAmount ?? new Prisma.Decimal(0)), lineSubtotals);
  const other = allocate(decimalNumber(invoice.otherLandedCost), lineSubtotals);
  const attachedEvidence = attachedLandedCostEvidenceForInvoice(invoice);
  const attachedEvidenceAllocated = allocate(attachedEvidence.total, lineSubtotals);
  const recoverableTax = allocate(decimalNumber(invoice.taxRecoverableAmount ?? invoice.taxCost), lineSubtotals);

  return invoice.lines.map((line, index) => {
    const warnings: string[] = [];
    if (!line.purchaseOrderLineId) warnings.push("No PO line link; review landed-cost allocation manually before using for inventory valuation.");
    if (subtotal <= 0) warnings.push("Invoice line subtotal is zero; allocation basis could not use value weighting.");
    if (attachedEvidence.total > 0 && invoice.currency !== "USD") warnings.push("Attached landed-cost evidence is normalized to USD; review non-USD invoice display before export.");
    const lineSubtotal = lineSubtotals[index] ?? 0;
    const landedTotal = round2(lineSubtotal + freight[index] + duty[index] + brokerage[index] + nonRecoverableTax[index] + other[index] + attachedEvidenceAllocated[index]);
    const landedUnitCost = line.quantity > 0 ? round4(landedTotal / line.quantity) : 0;
    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceLineId: line.id,
      purchaseOrderId: invoice.purchaseOrderId ?? invoice.purchaseOrder?.id ?? undefined,
      purchaseOrderLineId: line.purchaseOrderLineId ?? undefined,
      itemId: line.itemId ?? undefined,
      sku: line.item?.sku,
      description: line.description,
      quantity: line.quantity,
      currency: invoice.currency,
      lineSubtotal,
      allocatedFreight: freight[index],
      allocatedDuty: duty[index],
      allocatedBrokerage: brokerage[index],
      allocatedNonRecoverableTax: nonRecoverableTax[index],
      allocatedOther: other[index],
      allocatedAttachedLandedCostEvidence: attachedEvidenceAllocated[index],
      attachedLandedCostEvidenceRefs: attachedEvidence.refs,
      recoverableTaxExcluded: recoverableTax[index],
      landedTotal,
      landedUnitCost,
      warnings
    };
  });
}

function attachedLandedCostEvidenceForInvoice(invoice: InvoiceForLandedCost) {
  const documentsById = new Map<string, AccountingDocumentForLandedCost>();
  for (const document of invoice.accountingDocuments) documentsById.set(document.id, document);
  for (const document of invoice.purchaseOrder?.accountingDocuments ?? []) documentsById.set(document.id, document);

  let total = 0;
  const refs: string[] = [];
  for (const document of documentsById.values()) {
    if (document.status !== AccountingDocumentStatus.ATTACHED && document.status !== AccountingDocumentStatus.APPLIED) continue;
    const evidence = attachedDocumentLandedCostEvidence(document);
    if (!evidence) continue;
    total = round2(total + evidence.amountUsd);
    refs.push(`${document.originalFileName}: USD ${evidence.amountUsd.toFixed(2)}`);
  }

  return { total, refs };
}

function attachedDocumentLandedCostEvidence(document: AccountingDocumentForLandedCost) {
  const evidence = getAttachedLandedCostEvidenceAmount(document);
  return evidence ? { amountUsd: evidence.amountUsd } : null;
}

export function getAttachedLandedCostEvidenceAmount(document: {
  originalFileName: string;
  extractedText: string | null;
  analysisJson: unknown;
}) {
  const analysis = normalizeAnalysis(document.analysisJson);
  const text = document.extractedText ?? "";
  if (!isAttachedLandedCostEvidence(analysis?.classification, text, document.originalFileName)) return null;

  const amount = analysisAmount(analysis) ?? findAttachedPaymentAmount(text);
  if (!amount || amount.value <= 0) return null;
  return { amount: amount.value, currency: amount.currency, amountUsd: convertToUsd(amount.value, amount.currency) };
}

function isAttachedLandedCostEvidence(classification: string | undefined, text: string, fileName: string) {
  const combined = `${fileName}\n${text}`;
  const hasCustomsSignal = /customs|dut(?:y|ies)|brokerage|clearance|cbsa|import\s+(?:fees|charges|duty)|fedex\s+clearance/i.test(combined);
  const hasAdditionalShippingSignal = /additional\s+(?:shipping|freight)(?:\s+\w+){0,4}\s+(?:charge|charges|cost|costs|fee|fees|receipt|surcharge|surcharges)\b|(?:freight|carrier|logistics)(?:\s+\w+){0,4}\s+(?:charge|charges|cost|costs|fee|fees|receipt|surcharge|surcharges)\b|(?:shipping|freight)\s+(?:surcharge|surcharges|adjustment|adjustments|overage|overages|rebill|re-bill)\b/i.test(combined);
  if (classification === "CUSTOMS_DOCUMENT") return true;
  return classification === "PAYMENT_RECEIPT" && (hasCustomsSignal || hasAdditionalShippingSignal);
}

function analysisAmount(analysis: ReturnType<typeof normalizeAnalysis>) {
  if (!analysis?.total || analysis.total <= 0) return null;
  return { value: analysis.total, currency: analysis.currency || "USD" };
}

function normalizeAnalysis(value: unknown): { classification?: string; currency?: string; total?: number } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as { schemaVersion?: string; classification?: string; currency?: string; total?: number };
  return candidate.schemaVersion === "accounting-document-v1" ? candidate : undefined;
}

function findAttachedPaymentAmount(text: string) {
  const charged = text.match(/\bcharged\s+([0-9][0-9,]*(?:\.\d{1,2})?)\s*([A-Z]{3})\b/i);
  if (charged) return { value: Number(charged[1].replace(/,/g, "")), currency: charged[2].toUpperCase() };

  const total = text.match(/\btotal\b[\s\S]{0,80}?([0-9][0-9,]*(?:\.\d{1,2})?)\s*([A-Z]{3})?\b/i);
  if (total) return { value: Number(total[1].replace(/,/g, "")), currency: (total[2] ?? "USD").toUpperCase() };

  const codeFirst = text.match(/\b([A-Z]{3})\b\s*\$?\s*([0-9][0-9,]*(?:\.\d{1,2})?)\b/i);
  if (codeFirst) return { value: Number(codeFirst[2].replace(/,/g, "")), currency: codeFirst[1].toUpperCase() };

  return null;
}

function allocate(amount: number, bases: number[]) {
  return allocateOrderLevelCost(amount, bases.map((basis) => ({ quantity: 1, lineTotal: basis })));
}

function decimalNumber(value: Prisma.Decimal.Value) {
  return Number(new Prisma.Decimal(value).toFixed(2));
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function round4(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function money(value: number) {
  return value.toFixed(2);
}

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
