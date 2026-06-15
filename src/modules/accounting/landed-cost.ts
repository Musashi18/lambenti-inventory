import { InvoiceStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
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
  recoverableTaxExcluded: number;
  landedTotal: number;
  landedUnitCost: number;
  warnings: string[];
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
      lines: { include: { item: true, purchaseOrderLine: true }, orderBy: { description: "asc" } },
      purchaseOrder: true
    },
    orderBy: [{ invoiceDate: "asc" }, { invoiceNumber: "asc" }]
  });

  return invoices.flatMap((invoice) => landedCostRowsForInvoice(invoice));
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
  lines: Array<{
    id: string;
    itemId: string | null;
    purchaseOrderLineId: string | null;
    description: string;
    quantity: number;
    lineTotal: Prisma.Decimal;
    item: { sku: string } | null;
  }>;
  purchaseOrder: { id: string } | null;
};

function landedCostRowsForInvoice(invoice: InvoiceForLandedCost): LandedCostRow[] {
  const lineSubtotals = invoice.lines.map((line) => decimalNumber(line.lineTotal));
  const subtotal = lineSubtotals.reduce((total, value) => total + value, 0);
  const freight = allocate(decimalNumber(invoice.shippingCost), lineSubtotals);
  const duty = allocate(decimalNumber(invoice.dutyCost), lineSubtotals);
  const brokerage = allocate(decimalNumber(invoice.brokerageCost), lineSubtotals);
  const nonRecoverableTax = allocate(decimalNumber(invoice.taxNonRecoverableAmount ?? new Prisma.Decimal(0)), lineSubtotals);
  const other = allocate(decimalNumber(invoice.otherLandedCost), lineSubtotals);
  const recoverableTax = allocate(decimalNumber(invoice.taxRecoverableAmount ?? invoice.taxCost), lineSubtotals);

  return invoice.lines.map((line, index) => {
    const warnings: string[] = [];
    if (!line.purchaseOrderLineId) warnings.push("No PO line link; review landed-cost allocation manually before using for inventory valuation.");
    if (subtotal <= 0) warnings.push("Invoice line subtotal is zero; allocation basis could not use value weighting.");
    const lineSubtotal = lineSubtotals[index] ?? 0;
    const landedTotal = round2(lineSubtotal + freight[index] + duty[index] + brokerage[index] + nonRecoverableTax[index] + other[index]);
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
      recoverableTaxExcluded: recoverableTax[index],
      landedTotal,
      landedUnitCost,
      warnings
    };
  });
}

function allocate(amount: number, bases: number[]) {
  if (bases.length === 0) return [];
  const totalBasis = bases.reduce((total, value) => total + value, 0);
  if (totalBasis <= 0) {
    const equal = round2(amount / bases.length);
    return bases.map((_, index) => index === bases.length - 1 ? round2(amount - equal * (bases.length - 1)) : equal);
  }
  let allocated = 0;
  return bases.map((basis, index) => {
    if (index === bases.length - 1) return round2(amount - allocated);
    const value = round2(amount * (basis / totalBasis));
    allocated += value;
    return value;
  });
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
