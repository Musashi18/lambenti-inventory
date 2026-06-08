import * as crypto from "node:crypto";
import { CostConfidence, Prisma } from "@prisma/client";
import { createInvoiceFromPurchaseOrder } from "@/modules/accounting/invoices";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { DEFAULT_CURRENCY, convertToUsd, isUsdConversionSupported } from "@/modules/currency";

type ParsedAlibabaEmail = {
  sourceHash: string;
  subject?: string;
  fromAddress?: string;
  sourceMessageId?: string;
  sourceUrl?: string;
  externalOrderId?: string;
  supplierName: string;
  orderDate?: Date;
  currency: string;
  subtotal?: number;
  shippingCost?: number;
  taxCost?: number;
  totalCost?: number;
  confidence: CostConfidence;
  lines: ParsedAlibabaLine[];
};

type ParsedAlibabaLine = {
  lineNo: number;
  rawDescription: string;
  supplierSku?: string;
  productUrl?: string;
  quantity: number;
  unitPrice?: number;
  lineTotal?: number;
  shippingAllocated?: number;
  taxAllocated?: number;
  landedUnitCost?: number;
  currency: string;
};

type MatchedAlibabaLine = ParsedAlibabaLine & {
  matchedItem: { id: string } | null;
  matchConfidence: string;
};

export type EmailImportResult = Awaited<ReturnType<typeof importAlibabaEmailOrder>>;

const CURRENCIES = ["USD", "CAD", "CNY", "RMB", "CN¥", "US$", "CA$", "C$"];
const CURRENCY_REGEX = new RegExp(`(?:${CURRENCIES.map(escapeRegex).join("|")}|\\$|¥)`, "i");
const AUTO_APPLY_MATCHES = new Set(["SKU", "SUPPLIER_SKU", "ALIAS", "FUZZY_HIGH", "MANUAL"]);
const SYNCED_EMAIL_SOURCE = "SYNCED_EMAIL";

const ITEM_ALIASES: Array<{
  sku: string;
  all: RegExp[];
  none?: RegExp[];
}> = [
  { sku: "LED-COB-12V-3000K", all: [/\bcob\b/i, /\bled\b/i, /\bstrip/i, /3000\s*k/i], none: [/6500\s*k/i] },
  { sku: "LED-COB-12V-6500K", all: [/\bcob\b/i, /\bled\b/i, /\bstrip/i, /6500\s*k/i], none: [/3000\s*k/i] },
  { sku: "PSU-12V-GS-UL", all: [/\bgs\b/i, /\bul\b/i, /power\s+adapt(?:e|o)r/i] },
  { sku: "CABLE-UL2464-2C-1P5M", all: [/ul\s*2464/i, /24\s*awg/i, /\bcable\b/i], none: [/connector|header|pin\s+header|cable\s+ties?|organizer/i] }
];

export function parseAlibabaEmail(rawText: string): ParsedAlibabaEmail {
  const normalized = normalizeEmailText(rawText);
  const compact = normalized.replace(/\s+/g, " ").trim();
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const subject = findHeader(lines, "Subject");
  const fromAddress = findHeader(lines, "From");
  const sourceMessageId = findHeader(lines, "Message-ID") ?? findHeader(lines, "Message-Id");
  const sourceUrl = findSourceUrl(normalized);
  const currency = normalizeCurrency(findFirstCurrency(normalized));

  const parsedLines = parseLineItems(normalized, currency);
  const subtotalFromLines = parsedLines.length > 0 ? roundMoney(parsedLines.reduce((total, line) => total + (line.lineTotal ?? ((line.unitPrice ?? 0) * line.quantity)), 0)) : undefined;
  const shippingCost = findMoney(normalized, ["Shipping fee", "Shipping & handling", "Shipping and handling", "Shipping", "Delivery fee", "Delivery", "Freight charge", "Freight", "Logistics fee", "Logistics", "Handling"]);
  const taxCost = findMoney(normalized, ["Tax/duty", "Tax and duty", "Duties and taxes", "Duties & taxes", "GST/HST", "GST", "HST", "VAT", "Tax", "Import duty", "Import duties", "Duties", "Duty"]);
  const subtotal = (parsedLines.length > 1 ? subtotalFromLines : undefined)
    ?? findMoney(normalized, ["Item subtotal", "Items subtotal", "Subtotal", "Merchandise Total", "Merchandise subtotal", "Product Total", "Products total", "Items Total"])
    ?? subtotalFromLines;
  const totalCost = findMoney(normalized, ["Grand Total", "Order Total", "Invoice Total", "Amount due", "Balance due", "Amount Paid", "Total paid", "Paid amount", "Payment amount", "Initial payment", "Charged", "Paid", "Total"]);
  const linesWithLandedCosts = allocateLandedCosts(parsedLines, shippingCost, taxCost);

  return {
    sourceHash: crypto.createHash("sha256").update(normalized).digest("hex"),
    subject,
    fromAddress,
    sourceMessageId,
    sourceUrl,
    externalOrderId: findOrderId(normalized, subject),
    supplierName: findSupplierName(normalized, fromAddress),
    orderDate: parseDate(findDateText(normalized, compact)),
    currency,
    subtotal,
    shippingCost,
    taxCost,
    totalCost,
    confidence: linesWithLandedCosts.length > 0 && linesWithLandedCosts.some((line) => line.unitPrice || line.lineTotal) ? CostConfidence.CONFIRMED : CostConfidence.ESTIMATED,
    lines: linesWithLandedCosts.length > 0 ? linesWithLandedCosts : [fallbackLine(normalized, currency)]
  };
}

export async function importAlibabaEmailOrder(input: {
  rawText: string;
  actorId: string;
  autoApply?: boolean;
  autoCreateInvoice?: boolean;
  source?: string;
  sourceMessageId?: string;
  sourceUrl?: string;
  invoiceDocumentPath?: string;
  invoiceDocumentHash?: string;
  invoiceDocumentText?: string;
  invoiceDownloadedAt?: Date;
}) {
  const parsed = parseAlibabaEmail(input.rawText);
  const matchedLines = await matchLines(parsed.lines);
  const supplier = await findOrCreateSupplier(parsed.supplierName);
  const existingByHash = await prisma.emailOrderImport.findUnique({
    where: { sourceHash: parsed.sourceHash },
    include: { lines: { include: { matchedItem: true } }, supplier: true, purchaseOrder: true }
  });
  const existingByExternalOrder = !existingByHash && parsed.externalOrderId
    ? await prisma.emailOrderImport.findFirst({
        where: { externalOrderId: parsed.externalOrderId },
        orderBy: { createdAt: "desc" },
        include: { lines: { include: { matchedItem: true } }, supplier: true, purchaseOrder: true }
      })
    : null;
  const existing = existingByHash ?? existingByExternalOrder;

  if (existing) {
    const refreshed = existing.purchaseOrder
      ? await updateExistingImportProvenance(existing.id, input)
      : await mergeExistingImport(existing, parsed, matchedLines, supplier.id, input);
    if (refreshed.archivedAt) {
      return {
        import: refreshed,
        created: false,
        purchaseOrder: refreshed.purchaseOrder,
        invoice: null,
        matchedLines: matchedLines.filter((line) => line.matchedItem).length
      };
    }
    const applied = input.autoApply && !refreshed.purchaseOrder
      ? await applyAlibabaEmailOrderImport(refreshed.id, input.actorId, { autoCreateInvoice: input.autoCreateInvoice ?? true })
      : null;
    const invoice = refreshed.purchaseOrder && (input.autoCreateInvoice ?? input.autoApply ?? false)
      ? await createInvoiceFromPurchaseOrder(refreshed.purchaseOrder.id, input.actorId, invoiceSourceForImport(refreshed))
      : applied?.invoice ?? null;
    return {
      import: applied?.import ?? refreshed,
      created: false,
      purchaseOrder: applied?.purchaseOrder ?? refreshed.purchaseOrder,
      invoice,
      matchedLines: matchedLines.filter((line) => line.matchedItem).length
    };
  }

  const matchedCount = matchedLines.filter((line) => line.matchedItem).length;
  const order = await prisma.emailOrderImport.create({
    data: {
      source: input.source ?? SYNCED_EMAIL_SOURCE,
      sourceHash: parsed.sourceHash,
      sourceMessageId: input.sourceMessageId ?? parsed.sourceMessageId,
      sourceUrl: input.sourceUrl ?? parsed.sourceUrl,
      subject: parsed.subject,
      fromAddress: parsed.fromAddress,
      rawText: input.rawText,
      invoiceDocumentPath: input.invoiceDocumentPath,
      invoiceDocumentHash: input.invoiceDocumentHash,
      invoiceDocumentText: input.invoiceDocumentText,
      invoiceDownloadedAt: input.invoiceDownloadedAt,
      externalOrderId: parsed.externalOrderId,
      supplierName: parsed.supplierName,
      supplierId: supplier.id,
      orderDate: parsed.orderDate,
      currency: parsed.currency,
      subtotal: toDecimal(parsed.subtotal),
      shippingCost: toDecimal(parsed.shippingCost),
      taxCost: toDecimal(parsed.taxCost),
      totalCost: toDecimal(parsed.totalCost),
      confidence: parsed.confidence,
      status: matchedCount === parsed.lines.length ? "IMPORTED" : "NEEDS_REVIEW",
      lines: {
        create: matchedLines.map((line) => lineCreateData(line))
      }
    },
    include: { lines: { include: { matchedItem: true } }, supplier: true, purchaseOrder: true }
  });

  await writeAuditLog({
    actorType: "USER",
    actorId: input.actorId,
    action: "IMPORT_ALIBABA_EMAIL_ORDER",
    entityType: "EmailOrderImport",
    entityId: order.id,
    payload: { externalOrderId: parsed.externalOrderId, supplierName: parsed.supplierName, matchedCount }
  });

  const applied = input.autoApply
    ? await applyAlibabaEmailOrderImport(order.id, input.actorId, { autoCreateInvoice: input.autoCreateInvoice ?? true })
    : null;
  return { import: applied?.import ?? order, created: true, purchaseOrder: applied?.purchaseOrder ?? null, invoice: applied?.invoice ?? null, matchedLines: matchedCount };
}

export async function applyAlibabaEmailOrderImport(importId: string, actorId: string, options: { autoCreateInvoice?: boolean } = {}) {
  let orderImport = await prisma.emailOrderImport.findUniqueOrThrow({
    where: { id: importId },
    include: { lines: { include: { matchedItem: true } }, supplier: true, purchaseOrder: true }
  });

  if (orderImport.archivedAt) {
    return { import: orderImport, purchaseOrder: orderImport.purchaseOrder, invoice: null };
  }

  if (orderImport.purchaseOrder) {
    const invoice = options.autoCreateInvoice ?? true
      ? await createInvoiceFromPurchaseOrder(orderImport.purchaseOrder.id, actorId, invoiceSourceForImport(orderImport))
      : null;
    return { import: orderImport, purchaseOrder: orderImport.purchaseOrder, invoice };
  }

  // Re-match against the current item catalog at apply time. This makes the app smart:
  // if an item was created after the email was imported, the old import can now apply
  // without re-importing the mailbox/email. Manual line edits are preserved so an
  // uncertain multi-item email can be corrected by the operator before apply.
  const hasManualLineEdits = orderImport.lines.some((line) => line.matchConfidence.startsWith("MANUAL"));
  if (!hasManualLineEdits) {
    const reparsed = parseAlibabaEmail(orderImport.rawText);
    const rematchedLines = await matchLines(reparsed.lines);
    const supplier = await findOrCreateSupplier(reparsed.supplierName || orderImport.supplierName);
    orderImport = await refreshExistingImport(orderImport.id, reparsed, rematchedLines, supplier.id);
  }

  const matchedLines = orderImport.lines.filter((line) =>
    line.matchedItemId && line.unitPrice && AUTO_APPLY_MATCHES.has(line.matchConfidence)
  );
  const everyLineReadyToApply = orderImport.lines.length > 0 && matchedLines.length === orderImport.lines.length;
  const unsupportedCurrencyLine = matchedLines.find((line) => !isUsdConversionSupported(line.currency));

  if (!orderImport.supplierId || !everyLineReadyToApply || unsupportedCurrencyLine) {
    const updated = await prisma.emailOrderImport.update({
      where: { id: importId },
      data: { status: "NEEDS_REVIEW" },
      include: { lines: { include: { matchedItem: true } }, supplier: true, purchaseOrder: true }
    });
    return { import: updated, purchaseOrder: null, invoice: null };
  }

  const applied = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const claim = await tx.emailOrderImport.updateMany({
      where: {
        id: importId,
        purchaseOrderId: null,
        archivedAt: null
      },
      data: { updatedAt: new Date() }
    });

    const currentImport = await tx.emailOrderImport.findUniqueOrThrow({
      where: { id: importId },
      include: { lines: { include: { matchedItem: true } }, supplier: true, purchaseOrder: true }
    });

    if (claim.count !== 1 || currentImport.purchaseOrder || currentImport.archivedAt) {
      return { purchaseOrder: currentImport.purchaseOrder, updated: currentImport };
    }

    const currentMatchedLines = currentImport.lines.filter((line) =>
      line.matchedItemId && line.unitPrice && AUTO_APPLY_MATCHES.has(line.matchConfidence)
    );
    const allCurrentLinesReady = currentImport.lines.length > 0 && currentMatchedLines.length === currentImport.lines.length;
    const currentUnsupportedCurrencyLine = currentMatchedLines.find((line) => !isUsdConversionSupported(line.currency));

    if (!currentImport.supplierId || !allCurrentLinesReady || currentUnsupportedCurrencyLine) {
      const updated = await tx.emailOrderImport.update({
        where: { id: importId },
        data: { status: "NEEDS_REVIEW" },
        include: { lines: { include: { matchedItem: true } }, supplier: true, purchaseOrder: true }
      });
      return { purchaseOrder: null, updated };
    }

    const purchaseOrder = await tx.purchaseOrder.create({
      data: {
        supplierId: currentImport.supplierId,
        status: "ORDERED",
        orderedAt: currentImport.orderDate ?? new Date(),
        lines: {
          create: currentMatchedLines.map((line) => ({
            itemId: line.matchedItemId!,
            quantity: line.quantity,
            unitPrice: convertToUsd(Number(line.unitPrice!), line.currency)
          }))
        }
      },
      include: { lines: { include: { item: true } }, supplier: true }
    });

    for (const line of currentMatchedLines) {
      const landedUnitCost = line.landedUnitCost ?? line.unitPrice;
      const landedUnitCostUsd = convertToUsd(Number(landedUnitCost), line.currency);
      await tx.item.update({
        where: { id: line.matchedItemId! },
        data: {
          estimatedUnitCost: landedUnitCostUsd,
          costCurrency: DEFAULT_CURRENCY,
          costConfidence: currentImport.confidence,
          costSourceRef: buildCostSourceRef(currentImport.externalOrderId ?? currentImport.id, {
            quantity: line.quantity,
            unitPrice: toUsdDecimal(line.unitPrice, line.currency)!,
            lineTotal: toUsdDecimal(line.lineTotal, line.currency),
            shippingAllocated: toUsdDecimal(line.shippingAllocated, line.currency),
            taxAllocated: toUsdDecimal(line.taxAllocated, line.currency),
            landedUnitCost: toUsdDecimal(line.landedUnitCost, line.currency)
          }),
          preferredSupplierId: currentImport.supplierId,
          supplierSku: line.supplierSku ?? undefined
        }
      });
    }

    const updated = await tx.emailOrderImport.update({
      where: { id: importId },
      data: {
        status: "APPLIED",
        purchaseOrderId: purchaseOrder.id
      },
      include: { lines: { include: { matchedItem: true } }, supplier: true, purchaseOrder: true }
    });

    await writeAuditLog({
      actorType: "USER",
      actorId,
      action: "APPLY_ALIBABA_EMAIL_ORDER",
      entityType: "EmailOrderImport",
      entityId: importId,
      payload: {
        purchaseOrderId: purchaseOrder.id,
        updatedItemCount: currentMatchedLines.length,
        note: "Created ORDERED incoming purchase order. Physical stock was not received into inventory."
      }
    }, tx);

    return { purchaseOrder, updated };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

  const invoice = (options.autoCreateInvoice ?? true) && applied.purchaseOrder
    ? await createInvoiceFromPurchaseOrder(applied.purchaseOrder.id, actorId, invoiceSourceForImport(applied.updated))
    : null;

  return { import: applied.updated, purchaseOrder: applied.purchaseOrder, invoice };
}

export async function updateEmailOrderImportLine(input: {
  lineId: string;
  rawDescription: string;
  quantity: number;
  unitPrice?: number;
  currency?: string;
  matchedItemId?: string | null;
  actorId: string;
}) {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new Error("Email import line quantity must be a positive whole number.");
  }
  if (input.unitPrice !== undefined && input.unitPrice < 0) {
    throw new Error("Email import line unit price cannot be negative.");
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.emailOrderLineImport.findUnique({
      where: { id: input.lineId },
      include: { import: { include: { purchaseOrder: true } } }
    });
    if (!existing) throw new Error("Email import line does not exist.");
    if (existing.import.purchaseOrder) {
      throw new Error("This email import was already applied to a purchase order. Archive it or create a new corrected import instead of editing historical applied lines.");
    }

    const unitPrice = input.unitPrice ?? (existing.unitPrice ? Number(existing.unitPrice) : undefined);
    const lineTotal = unitPrice === undefined ? null : new Prisma.Decimal(roundMoney(unitPrice * input.quantity));
    const line = await tx.emailOrderLineImport.update({
      where: { id: input.lineId },
      data: {
        rawDescription: input.rawDescription.trim(),
        quantity: input.quantity,
        unitPrice: toDecimal(unitPrice),
        lineTotal,
        landedUnitCost: toDecimal(unitPrice),
        currency: normalizeCurrency(input.currency ?? existing.currency),
        matchedItemId: input.matchedItemId || null,
        matchConfidence: input.matchedItemId ? "MANUAL" : "MANUAL_NEEDS_REVIEW"
      }
    });

    const lines = await tx.emailOrderLineImport.findMany({ where: { importId: existing.importId } });
    const allMatched = lines.every((candidate) => candidate.id === line.id ? Boolean(input.matchedItemId) : Boolean(candidate.matchedItemId));
    await tx.emailOrderImport.update({
      where: { id: existing.importId },
      data: { status: allMatched ? "IMPORTED" : "NEEDS_REVIEW" }
    });

    await writeAuditLog({
      actorType: "USER",
      actorId: input.actorId,
      action: "UPDATE_EMAIL_ORDER_IMPORT_LINE",
      entityType: "EmailOrderLineImport",
      entityId: input.lineId,
      payload: {
        importId: existing.importId,
        rawDescription: line.rawDescription,
        quantity: line.quantity,
        unitPrice: line.unitPrice?.toString() ?? null,
        matchedItemId: line.matchedItemId,
        matchConfidence: line.matchConfidence
      }
    }, tx);

    return line;
  });
}

export async function getEmailOrderImports(options: { archivedOnly?: boolean } = {}) {
  const imports = await prisma.emailOrderImport.findMany({
    where: options.archivedOnly ? { archivedAt: { not: null } } : { archivedAt: null },
    include: { lines: { include: { matchedItem: true } }, supplier: true, purchaseOrder: true },
    orderBy: { createdAt: "desc" },
    take: options.archivedOnly ? 25 : 100
  });
  return options.archivedOnly ? imports : bestImportPerOrder(imports).slice(0, 25);
}

export async function reassessRecentEmailOrderImports(actorId: string) {
  const imports = await prisma.emailOrderImport.findMany({
    where: { archivedAt: null, purchaseOrderId: null },
    include: { lines: true },
    orderBy: { createdAt: "desc" },
    take: 25
  });

  let refreshed = 0;
  let skippedManual = 0;
  for (const orderImport of imports) {
    const reparsed = parseAlibabaEmail(orderImport.rawText);
    if (!shouldRefreshParsedImport(orderImport, reparsed)) continue;

    const hasManualLineEdits = orderImport.lines.some((line) => line.matchConfidence.startsWith("MANUAL"));
    if (hasManualLineEdits) {
      skippedManual += 1;
      continue;
    }

    const rematchedLines = await matchLines(reparsed.lines);
    const supplier = await findOrCreateSupplier(reparsed.supplierName || orderImport.supplierName);
    await refreshExistingImport(orderImport.id, reparsed, rematchedLines, supplier.id);
    refreshed += 1;
  }

  await writeAuditLog({
    actorType: "USER",
    actorId,
    action: "REASSESS_RECENT_EMAIL_ORDER_IMPORTS",
    entityType: "EmailOrderImport",
    entityId: "recent-active-imports",
    payload: { scanned: imports.length, refreshed, skippedManual }
  });

  return { scanned: imports.length, refreshed, skippedManual };
}

export async function archiveEmailOrderImport(importId: string, actorId: string, reason = "Ignored by operator") {
  const updated = await prisma.emailOrderImport.update({
    where: { id: importId },
    data: {
      archivedAt: new Date(),
      archivedBy: actorId,
      archiveReason: reason
    },
    include: { lines: { include: { matchedItem: true } }, supplier: true, purchaseOrder: true }
  });

  await writeAuditLog({
    actorType: "USER",
    actorId,
    action: "ARCHIVE_EMAIL_ORDER_IMPORT",
    entityType: "EmailOrderImport",
    entityId: importId,
    payload: {
      reason,
      source: updated.source,
      externalOrderId: updated.externalOrderId,
      note: "Archived/ignored in the Order Email Agent only. No inventory movement was created."
    }
  });

  return updated;
}

export async function unarchiveEmailOrderImport(importId: string, actorId: string) {
  const updated = await prisma.emailOrderImport.update({
    where: { id: importId },
    data: {
      archivedAt: null,
      archivedBy: null,
      archiveReason: null
    },
    include: { lines: { include: { matchedItem: true } }, supplier: true, purchaseOrder: true }
  });

  await writeAuditLog({
    actorType: "USER",
    actorId,
    action: "UNARCHIVE_EMAIL_ORDER_IMPORT",
    entityType: "EmailOrderImport",
    entityId: importId,
    payload: {
      source: updated.source,
      externalOrderId: updated.externalOrderId,
      note: "Restored an archived order email to the active review queue. No inventory movement was created."
    }
  });

  return updated;
}

export async function deleteArchivedEmailOrderImport(importId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const orderImport = await tx.emailOrderImport.findUniqueOrThrow({
      where: { id: importId },
      include: { _count: { select: { lines: true } } }
    });

    if (!orderImport.archivedAt) {
      throw new Error("Only archived order emails can be permanently deleted.");
    }
    if (orderImport.purchaseOrderId) {
      throw new Error("Archived order emails that were applied to a purchase order cannot be permanently deleted.");
    }

    await writeAuditLog({
      actorType: "USER",
      actorId,
      action: "DELETE_ARCHIVED_EMAIL_ORDER_IMPORT",
      entityType: "EmailOrderImport",
      entityId: importId,
      payload: {
        source: orderImport.source,
        externalOrderId: orderImport.externalOrderId,
        subject: orderImport.subject,
        lineCount: orderImport._count.lines,
        archivedAt: orderImport.archivedAt,
        archivedBy: orderImport.archivedBy,
        archiveReason: orderImport.archiveReason,
        note: "Permanently deleted an archived, unapplied order email import and its parsed lines. No inventory movement was created."
      }
    }, tx);

    return tx.emailOrderImport.delete({ where: { id: importId } });
  });
}

async function updateExistingImportProvenance(
  importId: string,
  metadata: {
    source?: string;
    sourceMessageId?: string;
    sourceUrl?: string;
    invoiceDocumentPath?: string;
    invoiceDocumentHash?: string;
    invoiceDocumentText?: string;
    invoiceDownloadedAt?: Date;
  }
) {
  if (!metadata.source && !metadata.sourceMessageId && !metadata.sourceUrl && !metadata.invoiceDocumentPath && !metadata.invoiceDocumentHash && !metadata.invoiceDocumentText && !metadata.invoiceDownloadedAt) {
    return prisma.emailOrderImport.findUniqueOrThrow({
      where: { id: importId },
      include: { lines: { include: { matchedItem: true } }, supplier: true, purchaseOrder: true }
    });
  }

  return prisma.emailOrderImport.update({
    where: { id: importId },
    data: {
      source: metadata.source,
      sourceMessageId: metadata.sourceMessageId,
      sourceUrl: metadata.sourceUrl,
      invoiceDocumentPath: metadata.invoiceDocumentPath,
      invoiceDocumentHash: metadata.invoiceDocumentHash,
      invoiceDocumentText: metadata.invoiceDocumentText,
      invoiceDownloadedAt: metadata.invoiceDownloadedAt
    },
    include: { lines: { include: { matchedItem: true } }, supplier: true, purchaseOrder: true }
  });
}

type ExistingEmailImportForMerge = {
  id: string;
  source: string;
  sourceMessageId: string | null;
  sourceUrl: string | null;
  subject: string | null;
  fromAddress: string | null;
  rawText?: string | null;
  externalOrderId: string | null;
  supplierName: string;
  supplierId: string | null;
  orderDate: Date | null;
  currency: string;
  subtotal: Prisma.Decimal | null;
  shippingCost: Prisma.Decimal | null;
  taxCost: Prisma.Decimal | null;
  totalCost: Prisma.Decimal | null;
  invoiceDocumentPath: string | null;
  invoiceDocumentHash: string | null;
  invoiceDocumentText: string | null;
  invoiceDownloadedAt: Date | null;
  lines: Array<{ rawDescription: string; supplierSku: string | null; quantity: number; unitPrice: Prisma.Decimal | null; lineTotal: Prisma.Decimal | null }>;
  purchaseOrder?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
};

type EmailImportMetadata = {
  rawText?: string;
  source?: string;
  sourceMessageId?: string;
  sourceUrl?: string;
  invoiceDocumentPath?: string;
  invoiceDocumentHash?: string;
  invoiceDocumentText?: string;
  invoiceDownloadedAt?: Date;
};

async function mergeExistingImport(
  existing: ExistingEmailImportForMerge,
  parsed: ParsedAlibabaEmail,
  matchedLines: MatchedAlibabaLine[],
  supplierId: string,
  metadata: EmailImportMetadata
) {
  if (isParsedEmailMoreInformative(existing, parsed)) {
    return refreshExistingImport(existing.id, parsed, matchedLines, supplierId, metadata);
  }

  return updateExistingImportMissingFields(existing.id, existing, parsed, supplierId, metadata);
}

async function updateExistingImportMissingFields(
  importId: string,
  existing: ExistingEmailImportForMerge,
  parsed: ParsedAlibabaEmail,
  supplierId: string,
  metadata: EmailImportMetadata
) {
  return prisma.emailOrderImport.update({
    where: { id: importId },
    data: {
      source: metadata.source ?? existing.source,
      sourceMessageId: existing.sourceMessageId ?? metadata.sourceMessageId ?? parsed.sourceMessageId,
      sourceUrl: existing.sourceUrl ?? metadata.sourceUrl ?? parsed.sourceUrl,
      subject: existing.subject ?? parsed.subject,
      fromAddress: existing.fromAddress ?? parsed.fromAddress,
      invoiceDocumentPath: existing.invoiceDocumentPath ?? metadata.invoiceDocumentPath,
      invoiceDocumentHash: existing.invoiceDocumentHash ?? metadata.invoiceDocumentHash,
      invoiceDocumentText: existing.invoiceDocumentText ?? metadata.invoiceDocumentText,
      invoiceDownloadedAt: existing.invoiceDownloadedAt ?? metadata.invoiceDownloadedAt,
      externalOrderId: existing.externalOrderId ?? parsed.externalOrderId,
      supplierName: isUsefulSupplierName(existing.supplierName) ? existing.supplierName : parsed.supplierName,
      supplierId: existing.supplierId ?? supplierId,
      orderDate: existing.orderDate ?? parsed.orderDate,
      currency: existing.currency || parsed.currency,
      subtotal: existing.subtotal ?? toDecimal(parsed.subtotal),
      shippingCost: existing.shippingCost ?? toDecimal(parsed.shippingCost),
      taxCost: existing.taxCost ?? toDecimal(parsed.taxCost),
      totalCost: existing.totalCost ?? toDecimal(parsed.totalCost),
      confidence: parsed.confidence
    },
    include: { lines: { include: { matchedItem: true } }, supplier: true, purchaseOrder: true }
  });
}

async function refreshExistingImport(
  importId: string,
  parsed: ParsedAlibabaEmail,
  matchedLines: MatchedAlibabaLine[],
  supplierId: string,
  metadata?: {
    rawText?: string;
    source?: string;
    sourceMessageId?: string;
    sourceUrl?: string;
    invoiceDocumentPath?: string;
    invoiceDocumentHash?: string;
    invoiceDocumentText?: string;
    invoiceDownloadedAt?: Date;
  }
) {
  const matchedCount = matchedLines.filter((line) => line.matchedItem).length;
  return prisma.emailOrderImport.update({
    where: { id: importId },
    data: {
      source: metadata?.source,
      sourceHash: parsed.sourceHash,
      sourceMessageId: metadata?.sourceMessageId ?? parsed.sourceMessageId,
      sourceUrl: metadata?.sourceUrl ?? parsed.sourceUrl,
      subject: parsed.subject,
      fromAddress: parsed.fromAddress,
      rawText: metadata?.rawText,
      invoiceDocumentPath: metadata?.invoiceDocumentPath,
      invoiceDocumentHash: metadata?.invoiceDocumentHash,
      invoiceDocumentText: metadata?.invoiceDocumentText,
      invoiceDownloadedAt: metadata?.invoiceDownloadedAt,
      externalOrderId: parsed.externalOrderId,
      supplierName: parsed.supplierName,
      supplierId,
      orderDate: parsed.orderDate,
      currency: parsed.currency,
      subtotal: toDecimal(parsed.subtotal),
      shippingCost: toDecimal(parsed.shippingCost),
      taxCost: toDecimal(parsed.taxCost),
      totalCost: toDecimal(parsed.totalCost),
      confidence: parsed.confidence,
      status: matchedCount === parsed.lines.length ? "IMPORTED" : "NEEDS_REVIEW",
      lines: {
        deleteMany: {},
        create: matchedLines.map((line) => lineCreateData(line))
      }
    },
    include: { lines: { include: { matchedItem: true } }, supplier: true, purchaseOrder: true }
  });
}

function lineCreateData(line: MatchedAlibabaLine) {
  return {
    lineNo: line.lineNo,
    rawDescription: line.rawDescription,
    supplierSku: line.supplierSku,
    productUrl: line.productUrl,
    quantity: line.quantity,
    unitPrice: toDecimal(line.unitPrice),
    lineTotal: toDecimal(line.lineTotal),
    shippingAllocated: toDecimal(line.shippingAllocated),
    taxAllocated: toDecimal(line.taxAllocated),
    landedUnitCost: toDecimal(line.landedUnitCost),
    currency: line.currency,
    matchedItemId: line.matchedItem?.id,
    matchConfidence: line.matchConfidence
  };
}

async function matchLines(lines: ParsedAlibabaLine[]) {
  const items = await prisma.item.findMany({ where: { lifecycleStatus: { not: "OBSOLETE" } } });
  return lines.map((line): MatchedAlibabaLine => {
    const haystack = `${line.rawDescription} ${line.supplierSku ?? ""}`.toLowerCase();
    const exactSku = items.find((item) => haystack.includes(item.sku.toLowerCase()));
    const supplierSku = items.find((item) => item.supplierSku && haystack.includes(item.supplierSku.toLowerCase()));
    const aliasSku = findAliasSku(line.rawDescription);
    const alias = aliasSku ? items.find((item) => item.sku === aliasSku) : null;
    const descriptionWords = tokenize(line.rawDescription);
    const fuzzy = items
      .map((item) => ({ item, score: overlap(descriptionWords, tokenize(`${item.sku} ${item.description} ${item.manufacturerPartNo ?? ""}`)) }))
      .sort((a, b) => b.score - a.score)[0];

    const fuzzyMatch = fuzzy && fuzzy.score >= 5 ? fuzzy.item : null;
    const matchedItem = exactSku ?? supplierSku ?? alias ?? fuzzyMatch ?? null;
    return {
      ...line,
      matchedItem,
      matchConfidence: exactSku ? "SKU" : supplierSku ? "SUPPLIER_SKU" : alias ? "ALIAS" : fuzzyMatch ? "FUZZY_HIGH" : "UNMATCHED"
    };
  });
}

async function findOrCreateSupplier(name: string) {
  const existing = await prisma.supplier.findUnique({ where: { name } });
  if (existing) return existing;
  return prisma.supplier.create({
    data: {
      name,
      confirmedByHuman: false,
      moq: 1,
      leadTimeDays: 21,
      shippingCost: new Prisma.Decimal(0),
      reliabilityScore: new Prisma.Decimal(3),
      productPageUrl: name.toLowerCase().includes("alibaba") ? "https://www.alibaba.com" : undefined
    }
  });
}

function parseLineItems(text: string, fallbackCurrency: string): ParsedAlibabaLine[] {
  const compact = text.replace(/\s+/g, " ").trim();
  const results: ParsedAlibabaLine[] = [];
  appendUniqueLines(results, parseStructuredFieldBlocks(text, fallbackCurrency));
  appendUniqueLines(results, parseAlibabaGraphicalProductCards(text, fallbackCurrency));
  appendUniqueLines(results, parseGenericGraphicalProductCards(text, fallbackCurrency));
  appendUniqueLines(results, parseCompactOrderSummaryCards(text, fallbackCurrency));
  appendUniqueLines(results, parseDelimitedOrderRows(text, fallbackCurrency));
  appendUniqueLines(results, parseCompoundItemSummaryRows(text, fallbackCurrency));
  appendUniqueLines(results, parseSmartItemRows(text, fallbackCurrency));
  appendUniqueLines(results, parseAlibabaProductBlocks(compact, fallbackCurrency));
  const linePattern = /(?:item|product|description)?\s*[:\-]?\s*(.+?)\s+(?:qty|quantity)\s*[:x]?\s*([\d,]+)\s+(?:unit\s*price|price)\s*[:\-]?\s*(USD|CAD|CNY|RMB|US\$|CA\$|C\$|CN¥|\$|¥)?\s*([\d,]+(?:\.\d{1,4})?)(?:\s+(?:total|amount|line total)\s*[:\-]?\s*(?:USD|CAD|CNY|RMB|US\$|CA\$|C\$|CN¥|\$|¥)?\s*([\d,]+(?:\.\d{1,2})?))?/gi;

  for (const match of Array.from(compact.matchAll(linePattern))) {
    const [, rawDescription, rawQuantity, rawCurrency, rawUnitPrice, rawLineTotal] = match;
    const description = cleanDescription(rawDescription);
    if (description.length < 3 || isDuplicateDescription(results, description)) continue;
    const quantity = parseNumber(rawQuantity) ?? 1;
    const unitPrice = parseNumber(rawUnitPrice);
    const supplierSku = findInlineSku(match[0]);
    if (supplierSku && results.some((line) => line.supplierSku?.toLowerCase() === supplierSku.toLowerCase())) continue;
    if (!unitPrice) continue;
    appendUniqueLines(results, [{
      lineNo: results.length + 1,
      rawDescription: description,
      supplierSku,
      productUrl: match[0].match(/https?:\/\/\S+/i)?.[0],
      quantity,
      unitPrice,
      lineTotal: rawLineTotal ? parseNumber(rawLineTotal) : roundMoney(quantity * unitPrice),
      currency: normalizeCurrency(rawCurrency ?? fallbackCurrency)
    }]);
  }

  return results.map((line, index) => ({ ...line, lineNo: index + 1 }));
}

function appendUniqueLines(target: ParsedAlibabaLine[], lines: ParsedAlibabaLine[]) {
  for (const line of lines) {
    if (isDuplicateLine(target, line)) continue;
    target.push({ ...line, lineNo: target.length + 1 });
  }
}

function parseAlibabaGraphicalProductCards(text: string, fallbackCurrency: string): ParsedAlibabaLine[] {
  const normalized = normalizeEmailText(text);
  const sectionMatch = normalized.match(/(?:Your product and delivery information|Product and delivery information)\s*([\s\S]+?)(?=\n\s*Order summary\b|\s+Order summary\b|$)/i);
  const section = sectionMatch?.[1];
  if (!section) return [];

  const segments = section
    .split(/\bView details\b/i)
    .map((segment) => segment.replace(/^\s*(?:Your product and delivery information|Product and delivery information)\s*/i, "").trim())
    .filter(Boolean);

  const results: ParsedAlibabaLine[] = [];
  for (const segment of segments) {
    const compactSegment = segment.replace(/\s+/g, " ").trim();
    const match = compactSegment.match(/^(.+?)\s+Quantity\s*:\s*([\d,]+)\b([\s\S]*?)\bItem subtotal\s*:\s*(USD|CAD|CNY|RMB|US\$|CA\$|C\$|CN¥|\$|¥)?\s*([\d,]+(?:\.\d{1,4})?)/i);
    if (!match) continue;

    const [, rawDescriptionText, rawQuantity, detailText, rawCurrency, rawLineTotal] = match;
    const description = cleanDescription(rawDescriptionText);
    const quantity = parseNumber(rawQuantity);
    const lineTotal = parseNumber(rawLineTotal);
    if (!quantity || !lineTotal || description.length < 3) continue;
    if (isDuplicateDescription(results, description)) continue;

    results.push({
      lineNo: results.length + 1,
      rawDescription: description,
      supplierSku: findInlineSku(`${rawDescriptionText} ${detailText}`),
      productUrl: segment.match(/https?:\/\/\S+/i)?.[0],
      quantity,
      unitPrice: roundUnitCost(lineTotal / quantity),
      lineTotal,
      currency: normalizeCurrency(rawCurrency ?? findFirstCurrency(segment) ?? fallbackCurrency)
    });
  }

  return results;
}

function parseGenericGraphicalProductCards(text: string, fallbackCurrency: string): ParsedAlibabaLine[] {
  const normalized = normalizeEmailText(text);
  if (!/\b(?:product|item)\s+(?:image|photo|card)\b/i.test(normalized)) return [];

  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const results: ParsedAlibabaLine[] = [];
  const category = classifyEmailOrderCategory(normalized);

  for (let index = 0; index < lines.length; index += 1) {
    if (!isGenericGraphicCardStart(lines[index])) continue;

    const cardLines: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (isGenericGraphicCardStart(line)) {
        if (cardLines.length > 0 && cardLines.every(isGraphicImageMetadataLine)) continue;
        break;
      }
      if (cardLines.length > 0 && isOrderSummaryBoundary(line)) break;
      cardLines.push(line);
    }

    const parsed = parseGenericGraphicCard(cardLines, category, fallbackCurrency);
    if (!parsed) continue;
    if (isDuplicateLine(results, parsed)) continue;
    results.push({ ...parsed, lineNo: results.length + 1 });
  }

  return results;
}

function parseGenericGraphicCard(lines: string[], category: string, fallbackCurrency: string): Omit<ParsedAlibabaLine, "lineNo"> | null {
  const cardText = lines.join("\n");
  const supplierSku = findInlineSku(cardText);
  const imageReference = findGraphicImageReference(lines);
  const imageContext = imageReference ? cleanImageContext(imageReference) : undefined;
  const quantity = findNumberAfterGraphicLabels(lines, ["Qty", "Quantity", "Units", "Count"]);
  const lineTotal = findMoneyAfterGraphicLabels(lines, ["Item total", "Line total", "Line subtotal", "Amount", "Subtotal"]);
  const unitPrice = findMoneyAfterGraphicLabels(lines, ["Unit price", "Unit cost", "Price", "Cost", "Each"])
    ?? (quantity && lineTotal ? roundUnitCost(lineTotal / quantity) : undefined);
  const description = cleanGraphicCardDescription(lines, supplierSku, imageContext);

  if (!quantity || quantity <= 0 || !unitPrice || description.length < 3) return null;

  return {
    rawDescription: formatCategorizedDescription(category, supplierSku, description),
    supplierSku,
    productUrl: cardText.match(/https?:\/\/\S+/i)?.[0] ?? (imageReference ? `image:${imageReference}` : undefined),
    quantity,
    unitPrice,
    lineTotal: lineTotal ?? roundMoney(quantity * unitPrice),
    currency: normalizeCurrency(findFirstCurrency(cardText) ?? fallbackCurrency)
  };
}

function isGenericGraphicCardStart(line: string) {
  return /^(?:product|item)\s+(?:image|photo|card)(?:\s+\d+)?$/i.test(line.trim())
    || /^(?:image|photo)(?:\s+\d+)?$/i.test(line.trim());
}

function isGraphicImageMetadataLine(line: string) {
  return /^(?:attachment|image|product image)\s*(?:file(?:name)?|name|alt text|context)\s*:/i.test(line.trim());
}

function isOrderSummaryBoundary(line: string) {
  return /^(?:shipping|delivery|freight|gst\/hst|gst|hst|vat|tax|duty|duties|order\s+total|grand\s+total|invoice\s+total|total\s+paid|amount\s+due|subtotal|order\s+summary)\b/i.test(line.trim());
}

function findNumberAfterGraphicLabels(lines: string[], labels: string[]) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const label = labels.find((candidate) => new RegExp(`^${escapeRegex(candidate)}\\b`, "i").test(line));
    if (!label) continue;
    const inline = parseNumber(line.slice(label.length).match(/[\d,]+(?:\.\d+)?/)?.[0]);
    if (inline !== undefined) return inline;
    const next = parseNumber(lines[index + 1]?.match(/[\d,]+(?:\.\d+)?/)?.[0]);
    if (next !== undefined) return next;
  }
  return undefined;
}

function findMoneyAfterGraphicLabels(lines: string[], labels: string[]) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const label = labels.find((candidate) => new RegExp(`^${escapeRegex(candidate)}\\b`, "i").test(line));
    if (!label) continue;
    const inline = findMoneyValue(line.slice(label.length));
    if (inline !== undefined) return inline;
    const next = findMoneyValue(lines[index + 1] ?? "");
    if (next !== undefined) return next;
  }
  return undefined;
}

function cleanGraphicCardDescription(lines: string[], supplierSku?: string, imageContext?: string) {
  const descriptionLines = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (/^(?:attachment|image|product image)\s*(?:file(?:name)?|name|alt text|context)\s*:/i.test(trimmed)) return false;
    if (/^(?:sku|supplier\s+sku|model|part|qty|quantity|units|count|unit\s+price|unit\s+cost|price|cost|each|item\s+total|line\s+total|line\s+subtotal|amount|subtotal)\b/i.test(trimmed)) return false;
    if (/^(?:paid|thanks|thank you|product details?|view details?|order details?)\b/i.test(trimmed)) return false;
    if (/^[\d,]+(?:\.\d+)?$/.test(trimmed)) return false;
    if (CURRENCY_REGEX.test(trimmed) && /\d/.test(trimmed)) return false;
    return true;
  });
  const base = cleanDescription(removeInlineSkuText(descriptionLines.join(" - "), supplierSku));
  if (!imageContext) return base;
  if (!base) return `image ${imageContext}`;
  return base.toLowerCase().includes(imageContext.toLowerCase()) ? base : `${base} - image ${imageContext}`;
}

function findGraphicImageReference(lines: string[]) {
  for (const line of lines) {
    const match = line.trim().match(/^(?:attachment|image|product image)\s*(?:file(?:name)?|name|alt text|context)\s*:\s*(.+)$/i);
    if (match?.[1]) return cleanImageReference(match[1]);
  }
  return undefined;
}

function cleanImageReference(value: string) {
  return value.trim().replace(/^<|>$/g, "").replace(/[\s)\],;]+$/g, "");
}

function cleanImageContext(value: string) {
  const noQuery = value.split(/[?#]/)[0] ?? value;
  const filename = noQuery.split(/[\/\\]/).pop() ?? noQuery;
  const withoutExtension = filename.replace(/\.(?:png|jpe?g|webp|tiff?|bmp)$/i, "");
  const decoded = decodeURIComponentSafe(withoutExtension);
  return decoded
    .replace(/[_-]+/g, " ")
    .replace(/\b(?:image|img|photo|product|attachment|file)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function classifyEmailOrderCategory(text: string) {
  const subject = findHeader(text.split("\n"), "Subject") ?? text;
  if (/\breceipt\b/i.test(subject) || /\b(?:paid|amount paid|payment received|charged)\b/i.test(text)) return "Receipt";
  if (/\binvoice\b/i.test(subject) || /\bamount due\b/i.test(text)) return "Invoice";
  if (/\b(?:shipped|shipment|tracking|delivered)\b/i.test(subject)) return "Shipping";
  if (/\b(?:quote|quotation|estimate)\b/i.test(subject)) return "Quote";
  if (/\b(?:confirmed|confirmation)\b/i.test(subject)) return "Order confirmation";
  return "Order email";
}

function formatCategorizedDescription(category: string, supplierSku: string | undefined, description: string) {
  const base = supplierSku && !description.toLowerCase().includes(supplierSku.toLowerCase())
    ? `${supplierSku} - ${description}`
    : description;
  return `${category} — ${base}`;
}

function parseCompactOrderSummaryCards(text: string, fallbackCurrency: string): ParsedAlibabaLine[] {
  const normalized = normalizeEmailText(text);
  if (!/\b(?:order total|track order|see order details|your order\s+[A-Z0-9-]+\s+is confirmed)\b/i.test(normalized)) {
    return [];
  }

  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const cards = lines
    .map((line, index) => ({ quantity: parseCompactCardQuantity(line), index }))
    .filter((candidate): candidate is { quantity: number; index: number } => candidate.quantity !== undefined)
    .map((candidate) => ({
      quantity: candidate.quantity,
      description: compactCardDescriptionBefore(lines, candidate.index)
    }))
    .filter((card) => card.description.length >= 3);

  if (cards.length === 0) return [];

  const total = cards.length === 1
    ? findMoney(normalized, ["Order total", "Grand Total", "Order Total", "Total paid", "Total"])
    : undefined;
  const currency = normalizeCurrency(findFirstCurrency(normalized) ?? fallbackCurrency);

  return cards.map((card, index) => ({
    lineNo: index + 1,
    rawDescription: card.description,
    quantity: card.quantity,
    unitPrice: total ? roundUnitCost(total / card.quantity) : undefined,
    lineTotal: total,
    currency
  }));
}

function parseCompactCardQuantity(line: string) {
  const match = line.match(/^(?:x|×)\s*([\d,]+)$/i)
    ?? line.match(/^qty(?:uantity)?\s*[:#-]?\s*([\d,]+)$/i);
  return parseNumber(match?.[1]);
}

function compactCardDescriptionBefore(lines: string[], quantityIndex: number) {
  const parts: string[] = [];

  for (let index = quantityIndex - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line || parseCompactCardQuantity(line) !== undefined) break;
    if (isCompactOrderCardBoundary(line)) break;
    if (isCompactOrderCardNoise(line)) continue;
    parts.unshift(line);
    if (parts.length >= 3) break;
  }

  return cleanDescription(parts.join(" - "));
}

function isCompactOrderCardBoundary(line: string) {
  return /^(?:track order|see order details|order total|grand total|total paid|ship to|shipping address|order summary|from:|to:|subject:|date:|message-id:)\b/i.test(line)
    || /^hi\b/i.test(line)
    || /^your order\b/i.test(line);
}

function isCompactOrderCardNoise(line: string) {
  return /^\[.*\]$/.test(line)
    || /^https?:\/\//i.test(line)
    || /^view\b/i.test(line);
}

function parseCompoundItemSummaryRows(text: string, fallbackCurrency: string): ParsedAlibabaLine[] {
  const results: ParsedAlibabaLine[] = [];
  const summaryPattern = /(?:^|\n)\s*(?:items?|products?|order items?)\s*:\s*([\s\S]+?)(?=\n\s*(?:subtotal|shipping|tax|total|order summary|order id|subject|from)\b|$)/gi;

  for (const match of Array.from(text.matchAll(summaryPattern))) {
    const body = match[1]?.trim();
    if (!body) continue;

    for (const segment of splitCompoundItemSegments(body)) {
      const parsed = parseInlineItemRow(segment, fallbackCurrency);
      if (!parsed) continue;
      if (isDuplicateDescription(results, parsed.rawDescription)) continue;
      if (parsed.supplierSku && results.some((line) => line.supplierSku?.toLowerCase() === parsed.supplierSku?.toLowerCase())) continue;
      results.push({ ...parsed, lineNo: results.length + 1 });
    }
  }

  return results;
}

function splitCompoundItemSegments(body: string) {
  return body
    .replace(/(?:^|\n)\s*(?:[-*•]|\d+[.)-])\s*/g, "; ")
    .split(/\s*;\s*/)
    .map((segment) => segment.replace(/^\s*(?:items?|products?|order items?)\s*:\s*/i, "").replace(/\s+(?:subtotal|shipping|tax|total)\b.*$/i, "").trim())
    .filter(Boolean);
}

function parseStructuredFieldBlocks(text: string, fallbackCurrency: string): ParsedAlibabaLine[] {
  const blocks = text
    .split(/(?=^\s*(?:SKU|Supplier SKU|Model)\s*[:#-])/gim)
    .map((block) => block.trim())
    .filter((block) => /(?:SKU|Supplier SKU|Model)\s*[:#-]/i.test(block));

  const results: ParsedAlibabaLine[] = [];
  for (const block of blocks) {
    const supplierSku = findField(block, ["Supplier SKU", "SKU", "Model"]);
    const description = findField(block, ["Description", "Product", "Item"]);
    const quantity = parseNumber(findField(block, ["Quantity", "Qty"]));
    const unitPrice = findMoney(block, ["Unit price", "Unit Price", "Price"]);
    const lineTotal = findMoney(block, ["Line total", "Line Total", "Item subtotal", "Subtotal", "Amount"]);

    if (!quantity || quantity <= 0 || (!unitPrice && !lineTotal)) continue;

    const rawDescription = cleanDescription(
      supplierSku && description && !description.toLowerCase().includes(supplierSku.toLowerCase())
        ? `${supplierSku} - ${description}`
        : description ?? supplierSku ?? "Supplier order line"
    );
    if (rawDescription.length < 3 || isDuplicateDescription(results, rawDescription)) continue;

    const resolvedUnitPrice = unitPrice ?? (lineTotal ? roundUnitCost(lineTotal / quantity) : undefined);
    if (!resolvedUnitPrice) continue;

    results.push({
      lineNo: results.length + 1,
      rawDescription,
      supplierSku,
      productUrl: block.match(/https?:\/\/\S+/i)?.[0],
      quantity,
      unitPrice: resolvedUnitPrice,
      lineTotal: lineTotal ?? roundMoney(quantity * resolvedUnitPrice),
      currency: normalizeCurrency(findFirstCurrency(block) ?? fallbackCurrency)
    });
  }

  return results;
}

function parseDelimitedOrderRows(text: string, fallbackCurrency: string): ParsedAlibabaLine[] {
  const results: ParsedAlibabaLine[] = [];
  const rowPattern = /^\s*(?:\d+[.)-]?\s*)?([A-Z0-9][A-Z0-9._/-]{2,})\s*(?:,|\||\t)\s*(.+?)\s*(?:,|\||\t)\s*([\d,]+)\s*(?:,|\||\t)\s*(USD|CAD|CNY|RMB|US\$|CA\$|C\$|CN¥|\$|¥)?\s*([\d,]+(?:\.\d{1,4})?)(?:\s*(?:,|\||\t)\s*(?:USD|CAD|CNY|RMB|US\$|CA\$|C\$|CN¥|\$|¥)?\s*([\d,]+(?:\.\d{1,2})?))?\s*$/i;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || /^sku\s*(?:,|\||\t)/i.test(line) || /^(subtotal|shipping|tax|total)\b/i.test(line)) continue;
    const match = line.match(rowPattern);
    if (!match) continue;
    const [, supplierSku, description, rawQuantity, rawCurrency, rawUnitPrice, rawLineTotal] = match;
    const quantity = parseNumber(rawQuantity);
    const unitPrice = parseNumber(rawUnitPrice);
    if (!quantity || !unitPrice) continue;
    const rawDescription = cleanDescription(`${supplierSku} - ${description}`);
    if (isDuplicateDescription(results, rawDescription)) continue;
    results.push({
      lineNo: results.length + 1,
      rawDescription,
      supplierSku,
      quantity,
      unitPrice,
      lineTotal: rawLineTotal ? parseNumber(rawLineTotal) : roundMoney(quantity * unitPrice),
      currency: normalizeCurrency(rawCurrency ?? fallbackCurrency)
    });
  }

  return results;
}

function parseSmartItemRows(text: string, fallbackCurrency: string): ParsedAlibabaLine[] {
  const results: ParsedAlibabaLine[] = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!looksLikeSupplierItemRow(line)) continue;

    const parsed = parseSeparatedItemRow(line, fallbackCurrency) ?? parseInlineItemRow(line, fallbackCurrency);
    if (!parsed) continue;
    if (isDuplicateDescription(results, parsed.rawDescription)) continue;
    if (parsed.supplierSku && results.some((lineItem) => lineItem.supplierSku?.toLowerCase() === parsed.supplierSku?.toLowerCase())) continue;

    results.push({ ...parsed, lineNo: results.length + 1 });
  }

  return results;
}

function parseSeparatedItemRow(rawLine: string, fallbackCurrency: string): Omit<ParsedAlibabaLine, "lineNo"> | null {
  const line = stripListPrefix(rawLine);
  const parts = line.split(/\s*(?:\||\t|;|—|–)\s*/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) return null;

  const quantityIndex = parts.findIndex((part, index) => index > 0 && parseQuantity(part) !== undefined && !looksLikeMoneyPart(part) && !looksLikeStandaloneSku(part));
  if (quantityIndex < 1) return null;

  const quantity = parseQuantity(parts[quantityIndex]);
  const moneyParts = parts.slice(quantityIndex + 1);
  const unitPriceIndex = moneyParts.findIndex((part) => findMoneyValue(part) !== undefined);
  const unitPrice = unitPriceIndex >= 0 ? findMoneyValue(moneyParts[unitPriceIndex]) : undefined;
  const lineTotal = moneyParts.slice(unitPriceIndex + 1).map(findMoneyValue).find((value): value is number => value !== undefined)
    ?? (quantity && unitPrice ? roundMoney(quantity * unitPrice) : undefined);
  const { rawDescription, supplierSku } = describeSeparatedItem(parts.slice(0, quantityIndex));

  if (rawDescription.length < 3 || !quantity || !unitPrice) return null;

  return {
    rawDescription,
    supplierSku,
    productUrl: line.match(/https?:\/\/\S+/i)?.[0],
    quantity,
    unitPrice,
    lineTotal,
    currency: normalizeCurrency(findFirstCurrency(line) ?? fallbackCurrency)
  };
}

function parseInlineItemRow(rawLine: string, fallbackCurrency: string): Omit<ParsedAlibabaLine, "lineNo"> | null {
  const line = stripListPrefix(rawLine);
  const inlinePattern = /^(.+?)\s+(?:x|qty\s*[:#-]?|quantity\s*[:#-]?)\s*([\d,]+)\s*(?:pcs?|pieces|units?|ea|each|sets?)?\s*(?:@|at|unit\s*(?:price|cost)|price|cost|each)\s*[:#-]?\s*(USD|CAD|CNY|RMB|US\$|CA\$|C\$|CN¥|\$|¥)?\s*([\d,]+(?:\.\d{1,4})?)(?:\s*(?:\/\s*(?:pcs?|pc|piece|ea|each|unit))?)?(?:\s*(?:=|total|subtotal|line\s*(?:total|amount)|amount)\s*[:#-]?\s*(?:USD|CAD|CNY|RMB|US\$|CA\$|C\$|CN¥|\$|¥)?\s*([\d,]+(?:\.\d{1,2})?))?\s*$/i;
  const match = line.match(inlinePattern);
  if (!match) return null;

  const [, rawDescriptionText, rawQuantity, rawCurrency, rawUnitPrice, rawLineTotal] = match;
  const supplierSku = findSmartSupplierSku(rawDescriptionText);
  const rawDescription = cleanDescription(removeInlineSkuText(rawDescriptionText, supplierSku));
  const quantity = parseNumber(rawQuantity);
  const unitPrice = parseNumber(rawUnitPrice);
  if (rawDescription.length < 3 || !quantity || !unitPrice) return null;

  return {
    rawDescription,
    supplierSku,
    productUrl: line.match(/https?:\/\/\S+/i)?.[0],
    quantity,
    unitPrice,
    lineTotal: rawLineTotal ? parseNumber(rawLineTotal) : roundMoney(quantity * unitPrice),
    currency: normalizeCurrency(rawCurrency ?? findFirstCurrency(line) ?? fallbackCurrency)
  };
}

function looksLikeSupplierItemRow(line: string) {
  if (!line || /^(items? ordered|products?|subtotal|shipping|tax|total|order summary)\s*:?$/i.test(line)) return false;
  if (/^(?:items?|products?|order items?)\s*:/i.test(stripListPrefix(line))) return false;
  if (/^(subtotal|shipping|tax|total|order summary)\b/i.test(stripListPrefix(line))) return false;
  return /(?:\||\t|;)/.test(line) || /\b(?:qty|quantity|x)\s*[\d,]+\b/i.test(line);
}

function stripListPrefix(line: string) {
  return line.replace(/^\s*(?:[-*•]|\d+[.)-])\s*/, "").trim();
}

function parseQuantity(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^(?:qty|quantity)?\s*[:#-]?\s*([\d,]+)\s*(?:pcs?|pieces|units?|ea|each|sets?)?\s*$/i);
  return parseNumber(match?.[1]);
}

function looksLikeMoneyPart(value: string) {
  return /(?:USD|CAD|CNY|RMB|US\$|CA\$|C\$|CN¥|\$|¥)|\b(?:price|cost|amount|total|paid|due)\b/i.test(value);
}

function findMoneyValue(value: string) {
  return parseNumber(value.match(/(?:USD|CAD|CNY|RMB|US\$|CA\$|C\$|CN¥|\$|¥)?\s*([\d,]+(?:\.\d{1,4})?)/i)?.[1]);
}

function describeSeparatedItem(parts: string[]) {
  const cleaned = parts.map((part) => cleanField(part)).filter(Boolean);
  const inlineSku = cleaned.map(findInlineSku).find((value): value is string => Boolean(value));
  const standaloneSku = cleaned.find((part) => looksLikeStandaloneSku(part));
  const supplierSku = inlineSku ?? standaloneSku ?? cleaned.map(findSmartSupplierSku).find((value): value is string => Boolean(value));
  const descriptionPart = cleaned.find((part) => part !== standaloneSku && !looksLikeStandaloneSku(part)) ?? cleaned[0] ?? "Supplier order line";
  const description = cleanDescription(removeInlineSkuText(descriptionPart, supplierSku));
  const rawDescription = supplierSku && !description.toLowerCase().includes(supplierSku.toLowerCase())
    ? `${supplierSku} - ${description}`
    : description;
  return { rawDescription, supplierSku };
}

function looksLikeStandaloneSku(value: string) {
  const trimmed = value.trim();
  return /^[A-Z0-9][A-Z0-9._/-]{2,}$/i.test(trimmed)
    && !/\s/.test(trimmed)
    && (/[._/-]/.test(trimmed) || /^\d{5,}$/.test(trimmed) || /^[A-Z]{2,}\d+[A-Z0-9]*$/i.test(trimmed));
}

function removeInlineSkuText(value: string, supplierSku?: string) {
  let result = value.replace(/\b(?:supplier\s*)?(?:sku|model|part)\s*[:#-]?\s*[A-Z0-9][A-Z0-9._/-]{2,}\b/ig, " ");
  if (supplierSku) {
    result = result.replace(new RegExp(`\\b${escapeRegex(supplierSku)}\\b`, "ig"), " ");
  }
  return result.replace(/\s{2,}/g, " ").trim();
}

function findSmartSupplierSku(value: string) {
  const inline = findInlineSku(value);
  if (inline) return inline;
  const candidate = value.match(/\b([A-Z0-9][A-Z0-9._/-]{2,})\b/)?.[1];
  return candidate && looksLikeStandaloneSku(candidate) ? candidate : undefined;
}

function parseAlibabaProductBlocks(compact: string, fallbackCurrency: string): ParsedAlibabaLine[] {
  const results: ParsedAlibabaLine[] = [];
  const blockPattern = /(?:Your product and delivery information|Product and delivery information)\s+(.+?)\s+Quantity\s*:\s*([\d,]+)\s+(?:(?!Your product and delivery information|Product and delivery information|Order summary).)*?Item subtotal\s*:?\s*(USD|CAD|CNY|RMB|US\$|CA\$|C\$|CN¥|\$|¥)?\s*([\d,]+(?:\.\d{1,4})?)/gi;

  for (const match of Array.from(compact.matchAll(blockPattern))) {
    const [, rawDescription, rawQuantity, rawCurrency, rawLineTotal] = match;
    const quantity = parseNumber(rawQuantity) ?? 1;
    const lineTotal = parseNumber(rawLineTotal);
    const description = cleanDescription(rawDescription);
    if (!lineTotal || description.length < 3) continue;
    results.push({
      lineNo: results.length + 1,
      rawDescription: description,
      supplierSku: findInlineSku(match[0]),
      productUrl: match[0].match(/https?:\/\/\S+/i)?.[0],
      quantity,
      unitPrice: roundMoney(lineTotal / quantity),
      lineTotal,
      currency: normalizeCurrency(rawCurrency ?? fallbackCurrency)
    });
  }

  return results;
}

function allocateLandedCosts(lines: ParsedAlibabaLine[], shippingCost?: number, taxCost?: number) {
  if (lines.length === 0) return lines;
  const subtotal = lines.reduce((total, line) => total + (line.lineTotal ?? ((line.unitPrice ?? 0) * line.quantity)), 0);
  if (!subtotal) return lines;

  return lines.map((line) => {
    const baseTotal = line.lineTotal ?? ((line.unitPrice ?? 0) * line.quantity);
    const share = baseTotal / subtotal;
    const shippingAllocated = shippingCost ? roundMoney(shippingCost * share) : undefined;
    const taxAllocated = taxCost ? roundMoney(taxCost * share) : undefined;
    const landedTotal = baseTotal + (shippingAllocated ?? 0) + (taxAllocated ?? 0);
    return {
      ...line,
      shippingAllocated,
      taxAllocated,
      landedUnitCost: line.quantity > 0 ? roundUnitCost(landedTotal / line.quantity) : line.unitPrice
    };
  });
}

function fallbackLine(text: string, currency: string): ParsedAlibabaLine {
  const quantity = Number.parseInt(findField(text, ["Quantity", "Qty"]) ?? "1", 10) || 1;
  const unitPrice = findMoney(text, ["Unit Price", "Price"]);
  const lineTotal = findMoney(text, ["Line Total", "Item subtotal", "Subtotal", "Total"]);
  return {
    lineNo: 1,
    rawDescription: findField(text, ["Product", "Item", "Description"]) ?? "Unparsed order email line",
    supplierSku: findField(text, ["SKU", "Supplier SKU", "Model"]),
    productUrl: text.match(/https?:\/\/\S+/i)?.[0],
    quantity,
    unitPrice: unitPrice ?? (lineTotal ? roundUnitCost(lineTotal / quantity) : undefined),
    lineTotal,
    currency
  };
}

function findHeader(lines: string[], header: string) {
  const prefix = `${header.toLowerCase()}:`;
  return lines.find((line) => line.toLowerCase().startsWith(prefix))?.slice(prefix.length).trim();
}

function findField(text: string, labels: string[]) {
  for (const label of labels) {
    const match = text.match(new RegExp(`(?:^|\\n)\\s*${escapeRegex(label)}\\s*[:#-]?\\s*([^\\n|;]+)`, "i"));
    if (match?.[1]) return cleanField(match[1]);
  }
  return undefined;
}

function findSourceUrl(text: string) {
  const labeled = findUrlAfterLabels(text, [
    "Source URL",
    "Source",
    "Order link",
    "Order URL",
    "Order details",
    "View order details",
    "Invoice URL",
    "Invoice link",
    "Receipt URL",
    "Receipt link",
    "Payment link"
  ]);
  return labeled ?? cleanUrl(text.match(/https?:\/\/\S+/i)?.[0]);
}

function findUrlAfterLabels(text: string, labels: string[]) {
  for (const label of labels) {
    const match = text.match(new RegExp(`${escapeRegex(label)}\\s*[:#-]?\\s*(https?:\\/\\/\\S+)`, "i"));
    const cleaned = cleanUrl(match?.[1]);
    if (cleaned) return cleaned;
  }
  return undefined;
}

function cleanUrl(value?: string) {
  return value?.replace(/[)\],.;]+$/g, "").trim();
}

function findOrderId(text: string, subject?: string) {
  const candidates = [subject, text].filter(Boolean).join("\n");
  const explicit = findField(candidates, ["Order ID", "Order Number", "Order No", "Order #", "Invoice No", "Invoice Number", "Invoice #", "Receipt No", "Receipt Number", "PO Number", "Purchase Order", "Reference", "Transaction ID"]);
  if (explicit) return cleanIdentifier(explicit.split(/\s+/)[0]);
  const match = candidates.match(/(?:order\s*(?:id|no\.?|number|#)|Alibaba order|Trade Assurance order|invoice\s*(?:id|no\.?|number|#)|receipt\s*(?:id|no\.?|number|#))\s*[:.#-]?\s*([A-Z0-9][A-Z0-9-]*\d[A-Z0-9-]*)/i)
    ?? candidates.match(/\border\s+([A-Z0-9][A-Z0-9-]*\d[A-Z0-9-]*)\b/i)
    ?? candidates.match(/\binvoice\s+([A-Z0-9][A-Z0-9-]*\d[A-Z0-9-]*)\b/i)
    ?? candidates.match(/\(([A-Z0-9][A-Z0-9-]*\d[A-Z0-9-]*)\)/i);
  return cleanIdentifier(match?.[1]);
}

function cleanIdentifier(value?: string) {
  return value?.replace(/^[#:\-\.\s]+/, "").replace(/[).,;:]+$/g, "");
}

function findSupplierName(text: string, fromAddress?: string) {
  const supplierPayment = text.match(/supplier\s+(.+?)\s+has received/i)?.[1];
  if (supplierPayment) return cleanField(supplierPayment);
  return cleanField(findField(text, ["Supplier name", "Supplier", "Vendor name", "Vendor", "Seller name", "Seller", "Sold by", "Store", "Merchant", "Company name", "Company"]) ?? inferSupplierName(fromAddress, text));
}

function findDateText(text: string, compact: string) {
  return findField(text, ["Order Date", "Invoice Date", "Receipt Date", "Payment Date", "Paid On", "Paid Date", "Date Issued", "Issued On", "Shipment Date"])
    ?? compact.match(/Order date\s+([0-9]{4}-[0-9]{2}-[0-9]{2}(?:\s+[0-9:]+)?)/i)?.[1]
    ?? findHeader(text.split("\n"), "Date");
}

function findMoney(text: string, labels: string[]) {
  const compact = text.replace(/\s+/g, " ").replace(/\u00a0/g, " ");
  const money = String.raw`(?:USD|CAD|CNY|RMB|US\$|CA\$|C\$|CN¥|\$|¥)?\s*([0-9][0-9,]*(?:\.[0-9]{1,4})?)`;
  for (const label of labels) {
    const regex = new RegExp(`\\b${escapeRegex(label)}\\b\\s*[:#-]?\\s*${money}`, "gi");
    const matches = Array.from(compact.matchAll(regex));
    if (matches.length > 0) {
      const match = label.toLowerCase() === "total" ? matches[matches.length - 1] : matches[0];
      if (match?.[1]) return parseNumber(match[1]);
    }
  }
  return undefined;
}

function findFirstCurrency(text: string) {
  return text.match(CURRENCY_REGEX)?.[0];
}

function normalizeCurrency(value?: string) {
  if (!value) return "USD";
  const upper = value.toUpperCase();
  if (upper === "$" || upper === "US$") return "USD";
  if (upper === "C$" || upper === "CA$") return "CAD";
  if (upper === "¥" || upper === "CN¥" || upper === "RMB") return "CNY";
  return upper;
}

function parseDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value.replace(/\s+PST$/i, " -0800"));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function inferSupplierName(fromAddress: string | undefined, text: string) {
  if (fromAddress?.toLowerCase().includes("alibaba")) return "Alibaba supplier";
  const company = text.match(/([A-Z][A-Za-z0-9&.,' -]+(?:Co\.?|Ltd\.?|Limited|Factory|Supplier|Trading)[A-Za-z0-9&.,' -]*)/);
  return company?.[1]?.trim() ?? "Alibaba supplier";
}

function findInlineSku(line: string) {
  return line.match(/(?:sku|model|part)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i)?.[1];
}

function cleanDescription(value: string) {
  const labeledDescription = value.match(/(?:^|\s)Description\s*:\s*(.+)$/i)?.[1]
    ?? value.match(/(?:^|\s)Product\s*:\s*(.+)$/i)?.[1]
    ?? value.match(/(?:^|\s)Item\s*:\s*(.+)$/i)?.[1];
  return cleanField(labeledDescription ?? value)
    .replace(/^(item|product|description)\s*[:#-]?\s*/i, "")
    .replace(/\s+(?:View details|Order summary).*$/i, "")
    .trim();
}

function cleanField(value: string) {
  return value
    .replace(/^[#:\-\.\s]+/, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+(?:View order details|View details).*$/i, "")
    .trim();
}

function tokenize(value: string) {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length >= 3));
}

function overlap(a: Set<string>, b: Set<string>) {
  let count = 0;
  a.forEach((token) => {
    if (b.has(token)) count += 1;
  });
  return count;
}

function findAliasSku(description: string) {
  return ITEM_ALIASES.find((alias) =>
    alias.all.every((regex) => regex.test(description)) && !(alias.none ?? []).some((regex) => regex.test(description))
  )?.sku;
}

function isDuplicateDescription(lines: ParsedAlibabaLine[], description: string) {
  return lines.some((line) => line.rawDescription.toLowerCase() === description.toLowerCase());
}

function isDuplicateLine(lines: ParsedAlibabaLine[], candidate: Omit<ParsedAlibabaLine, "lineNo"> | ParsedAlibabaLine) {
  return lines.some((line) => {
    const sameSupplierSku = Boolean(candidate.supplierSku && line.supplierSku && line.supplierSku.toLowerCase() === candidate.supplierSku.toLowerCase());
    const sameQuantity = line.quantity === candidate.quantity;
    const sameUnitPrice = moneyEquivalent(line.unitPrice, candidate.unitPrice);
    const sameLineTotal = moneyEquivalent(line.lineTotal, candidate.lineTotal);
    const sameEconomics = sameQuantity && (sameUnitPrice || sameLineTotal);
    if (!sameEconomics) return false;
    if (hasConflictingImageContext(line, candidate)) return false;
    if (sameSupplierSku) return true;
    return descriptionsOverlap(line.rawDescription, candidate.rawDescription);
  });
}

function hasConflictingImageContext(
  line: ParsedAlibabaLine,
  candidate: Omit<ParsedAlibabaLine, "lineNo"> | ParsedAlibabaLine
) {
  const lineImageReference = imageReferenceDuplicateKey(line.productUrl);
  const candidateImageReference = imageReferenceDuplicateKey(candidate.productUrl);
  if (lineImageReference && candidateImageReference && lineImageReference !== candidateImageReference) return true;

  const lineImageContext = descriptionImageContextDuplicateKey(line.rawDescription);
  const candidateImageContext = descriptionImageContextDuplicateKey(candidate.rawDescription);
  return Boolean(lineImageContext && candidateImageContext && lineImageContext !== candidateImageContext);
}

function imageReferenceDuplicateKey(productUrl?: string) {
  if (!productUrl?.toLowerCase().startsWith("image:")) return undefined;
  return productUrl.slice("image:".length).trim().toLowerCase();
}

function descriptionImageContextDuplicateKey(description: string) {
  return description
    .match(/\s+-\s+image\s+(.+)$/i)?.[1]
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function moneyEquivalent(a?: number, b?: number) {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return Math.abs(a - b) < 0.0001;
}

function descriptionsOverlap(a: string, b: string) {
  const normalizedA = normalizeDescriptionForDuplicateCheck(a);
  const normalizedB = normalizeDescriptionForDuplicateCheck(b);
  if (normalizedA === normalizedB) return true;
  if (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)) return true;
  const tokensA = tokenize(normalizedA);
  const tokensB = tokenize(normalizedB);
  if (tokensA.size === 0 || tokensB.size === 0) return false;
  return overlap(tokensA, tokensB) >= Math.min(tokensA.size, tokensB.size, 3);
}

function normalizeDescriptionForDuplicateCheck(value: string) {
  return value
    .toLowerCase()
    .replace(/^(?:receipt|invoice|shipping|quote|order confirmation|order email)\s+—\s+/, "")
    .replace(/\s+-\s+image\s+[^|]+$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function bestImportPerOrder<T extends ExistingEmailImportForMerge>(imports: T[]): T[] {
  const byOrder = new Map<string, T>();
  const withoutOrder: T[] = [];

  for (const orderImport of imports) {
    const key = orderKeyForImport(orderImport);
    if (!key) {
      withoutOrder.push(orderImport);
      continue;
    }

    const current = byOrder.get(key);
    if (!current || existingImportInformationScore(orderImport) > existingImportInformationScore(current)) {
      byOrder.set(key, orderImport);
    }
  }

  return Array.from(byOrder.values()).concat(withoutOrder)
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

function orderKeyForImport(orderImport: Pick<ExistingEmailImportForMerge, "externalOrderId" | "subject" | "rawText">) {
  return normalizeOrderKey(orderImport.externalOrderId)
    ?? normalizeOrderKey(findOrderId(orderImport.rawText ?? "", orderImport.subject ?? undefined));
}

function shouldRefreshParsedImport(
  existing: ExistingEmailImportForMerge,
  parsed: ParsedAlibabaEmail
) {
  return shouldRefreshParsedLines(existing.lines, parsed.lines)
    || (!existing.externalOrderId && Boolean(parsed.externalOrderId))
    || (!existing.orderDate && Boolean(parsed.orderDate))
    || (!existing.subtotal && parsed.subtotal !== undefined)
    || (!existing.shippingCost && parsed.shippingCost !== undefined)
    || (!existing.taxCost && parsed.taxCost !== undefined)
    || (!existing.totalCost && parsed.totalCost !== undefined)
    || (!isUsefulSupplierName(existing.supplierName) && isUsefulSupplierName(parsed.supplierName));
}

function isParsedEmailMoreInformative(existing: ExistingEmailImportForMerge, parsed: ParsedAlibabaEmail) {
  const existingLineCount = effectiveExistingLineCount(existing.lines);
  const parsedLineCount = effectiveParsedLineCount(parsed.lines);
  if (parsedLineCount > existingLineCount) return true;
  if (parsedLineCount < existingLineCount) return false;
  return parsedEmailInformationScore(parsed) > existingImportInformationScore(existing) + 5;
}

function existingImportInformationScore(orderImport: ExistingEmailImportForMerge) {
  let score = effectiveExistingLineCount(orderImport.lines) * 100;
  for (const line of orderImport.lines) {
    if (line.supplierSku) score += 4;
    if (line.unitPrice) score += 4;
    if (line.lineTotal) score += 4;
    if (line.quantity > 0) score += 2;
    if (!isFallbackDescription(line.rawDescription)) score += 2;
  }
  if (orderImport.externalOrderId) score += 20;
  if (isUsefulSupplierName(orderImport.supplierName)) score += 10;
  if (orderImport.orderDate) score += 5;
  if (orderImport.subtotal) score += 5;
  if (orderImport.shippingCost) score += 5;
  if (orderImport.taxCost) score += 3;
  if (orderImport.totalCost) score += 5;
  if (orderImport.invoiceDocumentPath || orderImport.invoiceDocumentHash || orderImport.invoiceDocumentText) score += 5;
  return score;
}

function parsedEmailInformationScore(parsed: ParsedAlibabaEmail) {
  let score = effectiveParsedLineCount(parsed.lines) * 100;
  for (const line of parsed.lines) {
    if (line.supplierSku) score += 4;
    if (line.unitPrice) score += 4;
    if (line.lineTotal) score += 4;
    if (line.quantity > 0) score += 2;
    if (!isFallbackDescription(line.rawDescription)) score += 2;
  }
  if (parsed.externalOrderId) score += 20;
  if (isUsefulSupplierName(parsed.supplierName)) score += 10;
  if (parsed.orderDate) score += 5;
  if (parsed.subtotal !== undefined) score += 5;
  if (parsed.shippingCost !== undefined) score += 5;
  if (parsed.taxCost !== undefined) score += 3;
  if (parsed.totalCost !== undefined) score += 5;
  return score;
}

function effectiveExistingLineCount(lines: ExistingEmailImportForMerge["lines"]) {
  return lines.filter((line) => !isFallbackDescription(line.rawDescription)).length;
}

function effectiveParsedLineCount(lines: ParsedAlibabaLine[]) {
  return lines.filter((line) => !isFallbackDescription(line.rawDescription)).length;
}

function normalizeOrderKey(value?: string | null) {
  return value?.trim().toUpperCase() || null;
}

function isUsefulSupplierName(value: string) {
  const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalized.length < 2) return false;
  if (/^subject:|^from:|^order\s+test-|^supplier order\s+test-/i.test(value.trim())) return false;
  if (/\bhas received your initial payment\b/.test(normalized)) return false;
  if (/\bhas drafted a trade assurance contract\b/.test(normalized)) return false;
  if (/\bview order details\b/.test(normalized)) return false;
  if (["alibaba", "alibaba supplier", "supplier", "unknown supplier", "order email"].includes(normalized)) return false;
  return true;
}

function isFallbackDescription(value: string) {
  return /^unparsed (?:alibaba email order line|order email line)$/i.test(value.trim());
}

function shouldRefreshParsedLines(
  existingLines: Array<{ rawDescription: string; supplierSku: string | null; quantity: number; unitPrice: Prisma.Decimal | null; lineTotal: Prisma.Decimal | null }>,
  parsedLines: ParsedAlibabaLine[]
) {
  if (existingLines.length !== parsedLines.length) return true;
  return parsedLines.some((line, index) => parsedLineSignature(line) !== existingLineSignature(existingLines[index]));
}

function parsedLineSignature(line: ParsedAlibabaLine) {
  return [
    line.rawDescription.trim().toLowerCase(),
    line.supplierSku?.trim().toLowerCase() ?? "",
    line.quantity,
    line.unitPrice ?? "",
    line.lineTotal ?? ""
  ].join("|");
}

function existingLineSignature(line: { rawDescription: string; supplierSku: string | null; quantity: number; unitPrice: Prisma.Decimal | null; lineTotal: Prisma.Decimal | null }) {
  return [
    line.rawDescription.trim().toLowerCase(),
    line.supplierSku?.trim().toLowerCase() ?? "",
    line.quantity,
    line.unitPrice === null ? "" : Number(line.unitPrice),
    line.lineTotal === null ? "" : Number(line.lineTotal)
  ].join("|");
}

function toDecimal(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? new Prisma.Decimal(value) : undefined;
}

function toUsdDecimal(value: Prisma.Decimal | null | undefined, currency: string) {
  if (!value) return null;
  return new Prisma.Decimal(convertToUsd(Number(value), currency));
}

function invoiceSourceForImport(orderImport: {
  externalOrderId: string | null;
  invoiceDocumentPath?: string | null;
  invoiceDocumentHash?: string | null;
  sourceUrl?: string | null;
}) {
  return {
    sourceDocumentPath: orderImport.invoiceDocumentPath ?? undefined,
    sourceDocumentHash: orderImport.invoiceDocumentHash ?? undefined,
    externalSourceUrl: orderImport.sourceUrl ?? undefined,
    notes: `Auto-created from order email import${orderImport.externalOrderId ? ` order ${orderImport.externalOrderId}` : ""}. Verify against supplier invoice before marking paid. Physical inventory was not received.`
  };
}

function withSerializableRetry<T>(operation: () => Promise<T>, maxAttempts = 8): Promise<T> {
  let lastError: unknown;

  const attempt = async (remaining: number, attemptIndex: number): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableSerializableConflict(error) || remaining <= 1) throw error;
      await delayBeforeRetry(attemptIndex);
      return attempt(remaining - 1, attemptIndex + 1);
    }
  };

  return attempt(maxAttempts, 1).catch((error) => {
    throw error ?? lastError;
  });
}

function delayBeforeRetry(attempt: number) {
  const delayMs = Math.min(10 * 2 ** (attempt - 1), 250);
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function isRetryableSerializableConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

function parseNumber(value?: string) {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundUnitCost(value: number) {
  return Math.round(value * 10000) / 10000;
}

function normalizeEmailText(rawText: string) {
  return rawText
    .replace(/\r\n/g, "\n")
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/[ \f\v]+/g, " ");
}

function buildCostSourceRef(orderId: string, line: { quantity: number; unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal | null; shippingAllocated: Prisma.Decimal | null; taxAllocated: Prisma.Decimal | null; landedUnitCost: Prisma.Decimal | null }) {
  const pieces = [
    `Alibaba email import ${orderId}`,
    `qty ${line.quantity}`,
    `product unit ${line.unitPrice.toString()}`
  ];
  if (line.lineTotal) pieces.push(`line subtotal ${line.lineTotal.toString()}`);
  if (line.shippingAllocated) pieces.push(`shipping allocated ${line.shippingAllocated.toString()}`);
  if (line.taxAllocated) pieces.push(`tax allocated ${line.taxAllocated.toString()}`);
  if (line.landedUnitCost) pieces.push(`landed unit ${line.landedUnitCost.toString()}`);
  return pieces.join("; ");
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
