import { InvoiceStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type AccountingDateRange = { from?: Date; to?: Date };

export type GstHstExportRow = {
  invoiceId: string;
  invoiceNumber: string;
  supplierName: string;
  supplierTaxRegistrationNumber?: string;
  invoiceDate: string;
  status: InvoiceStatus;
  currency: string;
  subtotal: number;
  gstHstRecoverable: number;
  gstHstNonRecoverable: number;
  taxCost: number;
  total: number;
  sourceDocumentHash?: string;
  sourceDocumentPath?: string;
  warnings: string[];
};

export async function getGstHstExportRows(range: AccountingDateRange = {}): Promise<GstHstExportRow[]> {
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
    include: { supplier: true },
    orderBy: [{ invoiceDate: "asc" }, { invoiceNumber: "asc" }]
  });

  return invoices.map((invoice) => {
    const taxCost = decimalNumber(invoice.taxCost);
    const recoverable = decimalNumber(invoice.taxRecoverableAmount ?? invoice.taxCost);
    const nonRecoverable = decimalNumber(invoice.taxNonRecoverableAmount ?? new Prisma.Decimal(0));
    const warnings: string[] = [];
    if (recoverable > 0 && !invoice.supplier.taxRegistrationNumber) warnings.push("Missing supplier GST/HST registration number for ITC support.");
    if (recoverable > 0 && !invoice.sourceDocumentHash && !invoice.sourceDocumentPath) warnings.push("Missing source document evidence hash/path.");
    if (invoice.currency !== "CAD") warnings.push(`Review FX/source-currency treatment before filing; operational value is stored in ${invoice.currency}.`);

    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      supplierName: invoice.supplier.companyName ?? invoice.supplier.name,
      supplierTaxRegistrationNumber: invoice.supplier.taxRegistrationNumber ?? undefined,
      invoiceDate: invoice.invoiceDate.toISOString().slice(0, 10),
      status: invoice.status,
      currency: invoice.currency,
      subtotal: decimalNumber(invoice.subtotal),
      gstHstRecoverable: recoverable,
      gstHstNonRecoverable: nonRecoverable,
      taxCost,
      total: decimalNumber(invoice.total),
      sourceDocumentHash: invoice.sourceDocumentHash ?? undefined,
      sourceDocumentPath: invoice.sourceDocumentPath ?? undefined,
      warnings
    };
  });
}

export function formatGstHstCsv(rows: GstHstExportRow[]) {
  const header = [
    "invoiceNumber",
    "supplierName",
    "supplierTaxRegistrationNumber",
    "invoiceDate",
    "status",
    "currency",
    "subtotal",
    "gstHstRecoverable",
    "gstHstNonRecoverable",
    "taxCost",
    "total",
    "sourceDocumentHash",
    "sourceDocumentPath",
    "warnings"
  ];
  return [
    header.join(","),
    ...rows.map((row) => [
      row.invoiceNumber,
      row.supplierName,
      row.supplierTaxRegistrationNumber ?? "",
      row.invoiceDate,
      row.status,
      row.currency,
      money(row.subtotal),
      money(row.gstHstRecoverable),
      money(row.gstHstNonRecoverable),
      money(row.taxCost),
      money(row.total),
      row.sourceDocumentHash ?? "",
      row.sourceDocumentPath ?? "",
      row.warnings.join(" | ")
    ].map(csvCell).join(","))
  ].join("\n");
}

function decimalNumber(value: Prisma.Decimal.Value) {
  return Number(new Prisma.Decimal(value).toFixed(2));
}

function money(value: number) {
  return value.toFixed(2);
}

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
