import { createHash } from "node:crypto";
import { MovementType, Prisma, PurchaseOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import type { AlibabaPortalSnapshot } from "@/modules/alibaba-portal/snapshot";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type TrackingServiceConfig = {
  provider?: string;
  urlTemplate?: string;
  authToken?: string;
  authHeader?: string;
  refreshIntervalMinutes?: number;
  ship24BaseUrl?: string;
  destinationCountryCode?: string;
  originCountryCode?: string;
};

export type TrackingCaptureInput = {
  snapshot: AlibabaPortalSnapshot;
  actorId: string;
  emailOrderImportId?: string | null;
  source?: string;
  now?: Date;
  recentMonths?: number;
};

type TrackingLeadTimeEndSource = "RECEIVED" | "DELIVERED";

type TrackingLeadTimeResult = {
  startAt: Date | null;
  endAt: Date | null;
  endSource: TrackingLeadTimeEndSource | null;
  days: number | null;
  label: string | null;
};

export type TrackingDashboardRow = {
  id: string;
  trackingNumber: string;
  carrier: string | null;
  provider: string;
  currentStatus: string;
  statusDescription: string | null;
  refreshStatus: string;
  refreshError: string | null;
  externalOrderId: string | null;
  purchaseOrderId: string | null;
  emailOrderImportId: string | null;
  linkedOrderLabel: string;
  supplierName: string | null;
  source: string;
  sourceUrl: string | null;
  lastEventAt: Date | null;
  deliveredAt: Date | null;
  lastCheckedAt: Date | null;
  nextRefreshAt: Date | null;
  capturedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  paymentStartAt: Date | null;
  leadTimeEndAt: Date | null;
  leadTimeEndSource: "RECEIVED" | "DELIVERED" | null;
  leadTimeDays: number | null;
  leadTimeLabel: string | null;
  shipTimeStartedAt: Date | null;
  shipTimeEndedAt: Date | null;
  shipTimeMs: number | null;
  shipTimeLabel: string | null;
  eventCount: number;
  latestEvent: { description: string; location: string | null; occurredAt: Date | null } | null;
  relatedTrackingNumbers: string[];
  screenedShipmentCount: number;
  events: Array<{
    id: string;
    status: string | null;
    description: string;
    location: string | null;
    occurredAt: Date | null;
    createdAt: Date;
    rawEventJson: Prisma.JsonValue | null;
  }>;
  rawStatusJson: Prisma.JsonValue | null;
};

export type TrackingLinkOption = {
  purchaseOrderId: string;
  label: string;
  status: string;
  externalOrderId: string | null;
  supplierName: string;
  lineSkus: string[];
};

export type LeadTimeSummary = {
  averageDays: number;
  roundedDays: number;
  sampleCount: number;
  lastSampleAt: string | null;
  label: string;
};

export type LeadTimeSummaryIndex = {
  byItemId: Record<string, LeadTimeSummary>;
  bySupplierId: Record<string, LeadTimeSummary>;
};

export type LeadTimeLogEntry = {
  purchaseOrderId: string;
  externalOrderId: string | null;
  supplierId: string;
  supplierName: string;
  itemId: string;
  itemSku: string;
  itemDescription: string;
  quantityOrdered: number;
  quantityReceived: number;
  startAt: Date;
  endAt: Date;
  endSource: "RECEIVED" | "DELIVERED";
  leadTimeDays: number;
  leadTimeLabel: string;
  trackingNumbers: string[];
  shipTimeStartedAt: Date | null;
  shipTimeEndedAt: Date | null;
  shipTimeMs: number | null;
  shipTimeLabel: string | null;
};

export type LeadTimeLogItem = {
  itemId: string;
  itemSku: string;
  itemDescription: string;
  currentLeadTimeDays: number;
  manualLeadTimeDays: number | null;
  averageLeadTimeDays: number;
  weightedAverageLeadTimeDays: number;
  averageShipTimeDays: number | null;
  averageShipTimeLabel: string | null;
  leadTimeSource: "OBSERVED" | "MANUAL" | "CATALOG";
  leadTimeLabel: string;
  sampleCount: number;
  totalQuantityOrdered: number;
  totalQuantityReceived: number;
  entries: LeadTimeLogEntry[];
};

export type LeadTimeLog = {
  sampleCount: number;
  itemCount: number;
  totalQuantityOrdered: number;
  averageLeadTimeDays: number | null;
  averageShipTimeDays: number | null;
  items: LeadTimeLogItem[];
};

const DEFAULT_REFRESH_INTERVAL_MINUTES = 240;
const DEFAULT_SHIP24_BASE_URL = "https://api.ship24.com";
const TRACKING_REGEX = /\b(?:1Z[0-9A-Z]{16}|[A-Z]{2}\d{9}[A-Z]{2}|[A-Z]{1,5}\d{8,24}[A-Z]{0,4}|\d{10,24})\b/gi;
const STRONG_TRACKING_REGEX = /\b(?:1Z[0-9A-Z]{16}|[A-Z]{2}\d{9}[A-Z]{2})\b/gi;
const TRACKING_CONTEXT_REGEX = /\b(?:tracking|track\s+shipment|logistics|shipment|waybill|carrier|运单|物流|快递|追踪)\b/i;

export function getTrackingServiceConfig(env: NodeJS.ProcessEnv = process.env): TrackingServiceConfig {
  return {
    provider: normalizeProviderName(env.LAMBENTI_TRACKING_STATUS_PROVIDER || (env.LAMBENTI_TRACKING_STATUS_URL_TEMPLATE ? "CUSTOM_HTTP" : "UNCONFIGURED")),
    urlTemplate: blankToUndefined(env.LAMBENTI_TRACKING_STATUS_URL_TEMPLATE),
    authToken: blankToUndefined(env.LAMBENTI_TRACKING_STATUS_AUTH_TOKEN),
    authHeader: blankToUndefined(env.LAMBENTI_TRACKING_STATUS_AUTH_HEADER) ?? "authorization",
    refreshIntervalMinutes: positiveInt(env.LAMBENTI_TRACKING_REFRESH_INTERVAL_MINUTES, DEFAULT_REFRESH_INTERVAL_MINUTES),
    ship24BaseUrl: blankToUndefined(env.LAMBENTI_TRACKING_SHIP24_BASE_URL) ?? DEFAULT_SHIP24_BASE_URL,
    destinationCountryCode: normalizeCountryCode(env.LAMBENTI_TRACKING_DESTINATION_COUNTRY_CODE) ?? "CA",
    originCountryCode: normalizeCountryCode(env.LAMBENTI_TRACKING_ORIGIN_COUNTRY_CODE)
  };
}

function mergeTrackingServiceConfig(override?: TrackingServiceConfig): TrackingServiceConfig {
  const config = { ...getTrackingServiceConfig(), ...override };
  config.provider = normalizeProviderName(override?.provider ?? (override?.urlTemplate ? "CUSTOM_HTTP" : config.provider));
  return config;
}

export function normalizeTrackingNumber(value: string) {
  return value
    .replace(/[\u00a0\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:;#-]+|[\s,.;:]+$/g, "")
    .toUpperCase();
}

export function extractTrackingNumbersFromText(text: string) {
  const found = new Set<string>();
  const lines = String(text ?? "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const context = [lines[index - 1], lines[index], lines[index + 1]].filter(Boolean).join("\n");
    const hasTrackingContext = TRACKING_CONTEXT_REGEX.test(context);
    const regex = hasTrackingContext ? TRACKING_REGEX : STRONG_TRACKING_REGEX;
    regex.lastIndex = 0;
    for (const match of String(lines[index] ?? "").matchAll(regex)) {
      const normalized = normalizeTrackingNumber(match[0]);
      if (looksLikeTrackingNumber(normalized, { allowGenericNumeric: hasTrackingContext })) found.add(normalized);
    }
  }
  return [...found];
}

export function extractManualTrackingNumbersFromText(text: string) {
  const found = new Set<string>();
  TRACKING_REGEX.lastIndex = 0;
  for (const match of String(text ?? "").matchAll(TRACKING_REGEX)) {
    const normalized = normalizeTrackingNumber(match[0]);
    if (looksLikeTrackingNumber(normalized, { allowGenericNumeric: true })) found.add(normalized);
  }
  return [...found];
}

export async function getTrackingLinkOptions(input: { limit?: number } = {}): Promise<TrackingLinkOption[]> {
  const orders = await prisma.purchaseOrder.findMany({
    where: {
      status: { in: [PurchaseOrderStatus.ORDERED, PurchaseOrderStatus.PARTIALLY_RECEIVED, PurchaseOrderStatus.RECEIVED] }
    },
    include: {
      supplier: true,
      emailOrderImports: { orderBy: { updatedAt: "desc" }, select: { externalOrderId: true } },
      lines: { include: { item: { select: { sku: true } } } }
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: input.limit ?? 80
  });

  return orders.map((order) => {
    const externalOrderId = order.emailOrderImports.find((entry) => entry.externalOrderId)?.externalOrderId ?? null;
    const lineSkus = [...new Set(order.lines.map((line) => line.item.sku))];
    return {
      purchaseOrderId: order.id,
      status: order.status,
      externalOrderId,
      supplierName: order.supplier.name,
      lineSkus,
      label: [
        `PO ${order.id.slice(-8).toUpperCase()}`,
        order.supplier.name,
        order.status,
        externalOrderId ? `Alibaba ${externalOrderId}` : null,
        lineSkus.slice(0, 3).join(", ")
      ].filter(Boolean).join(" · ")
    };
  });
}

export async function captureManualTrackingNumbers(input: {
  rawText: string;
  actorId: string;
  externalOrderId?: string | null;
  purchaseOrderId?: string | null;
  supplierName?: string | null;
  sourceUrl?: string | null;
  source?: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const sourceUrl = blankToUndefined(input.sourceUrl ?? undefined) ?? extractFirstUrl(input.rawText);
  const evidenceText = [input.rawText, sourceUrl].filter(Boolean).join("\n");
  const externalOrderId = normalizeExternalOrderId(input.externalOrderId) ?? extractExternalOrderIdFromText(evidenceText);
  const excluded = new Set([externalOrderId].filter((value): value is string => Boolean(value)).map(normalizeTrackingNumber));
  const trackingNumbers = extractManualTrackingNumbersFromText(input.rawText)
    .filter((value) => !excluded.has(value));
  if (trackingNumbers.length === 0) return { saved: 0, updated: 0, skipped: 1, records: [] };

  const link = await resolveManualTrackingOrderLink({
    externalOrderId,
    purchaseOrderId: blankToUndefined(input.purchaseOrderId ?? undefined),
    supplierName: blankToUndefined(input.supplierName ?? undefined),
    rawText: evidenceText,
    sourceUrl
  });
  const source = blankToUndefined(input.source) ?? "MANUAL_DROPBOX";
  const records = [];
  let saved = 0;
  let updated = 0;

  for (const trackingNumber of unique(trackingNumbers)) {
    const existing = await prisma.trackingNumber.findUnique({ where: { trackingNumber } });
    const data = {
      carrier: inferCarrier(trackingNumber),
      provider: "UNCONFIGURED",
      source,
      sourceUrl,
      externalOrderId: link.externalOrderId,
      supplierName: link.supplierName,
      purchaseOrderId: link.purchaseOrderId,
      emailOrderImportId: link.emailOrderImportId,
      capturedAt: now,
      refreshStatus: "PENDING",
      nextRefreshAt: now
    };

    if (!existing) {
      const created = await prisma.trackingNumber.create({ data: { trackingNumber, ...data } });
      records.push(created);
      saved += 1;
      await writeAuditLog({
        actorType: "USER",
        actorId: input.actorId,
        action: "SAVE_MANUAL_TRACKING_NUMBER",
        entityType: "TrackingNumber",
        entityId: created.id,
        payload: {
          trackingNumber,
          source,
          sourceUrl,
          externalOrderId: created.externalOrderId,
          purchaseOrderId: created.purchaseOrderId,
          emailOrderImportId: created.emailOrderImportId
        }
      });
      continue;
    }

    const merged = await prisma.trackingNumber.update({
      where: { id: existing.id },
      data: {
        carrier: existing.carrier ?? data.carrier,
        source: existing.source,
        sourceUrl: existing.sourceUrl ?? data.sourceUrl,
        externalOrderId: existing.externalOrderId ?? data.externalOrderId,
        supplierName: existing.supplierName ?? data.supplierName,
        purchaseOrderId: existing.purchaseOrderId ?? data.purchaseOrderId,
        emailOrderImportId: existing.emailOrderImportId ?? data.emailOrderImportId,
        refreshStatus: existing.refreshStatus === "UNKNOWN" ? "PENDING" : existing.refreshStatus,
        nextRefreshAt: existing.currentStatus === "DELIVERED" ? null : existing.nextRefreshAt ?? data.nextRefreshAt
      }
    });
    records.push(merged);
    updated += 1;
    await writeAuditLog({
      actorType: "USER",
      actorId: input.actorId,
      action: "LINK_MANUAL_TRACKING_NUMBER",
      entityType: "TrackingNumber",
      entityId: merged.id,
      payload: {
        trackingNumber,
        source,
        sourceUrl: merged.sourceUrl,
        externalOrderId: merged.externalOrderId,
        purchaseOrderId: merged.purchaseOrderId,
        emailOrderImportId: merged.emailOrderImportId
      }
    });
  }

  for (const purchaseOrderId of unique(records.map((record) => record.purchaseOrderId).filter((value): value is string => Boolean(value)))) {
    await syncLeadTimeAveragesForPurchaseOrder(purchaseOrderId, input.actorId, "USER");
  }

  return { saved, updated, skipped: 0, records };
}

export async function captureTrackingNumbersFromPortalSnapshot(input: TrackingCaptureInput) {
  const now = input.now ?? new Date();
  const recentMonths = input.recentMonths ?? 3;
  const capturedAt = parseDate(input.snapshot.capturedAt) ?? now;
  const sourceText = [input.snapshot.conversationContext, input.snapshot.text].filter(Boolean).join("\n");
  const excluded = new Set(
    [input.snapshot.orderId]
      .filter((value): value is string => Boolean(value))
      .map(normalizeTrackingNumber)
  );

  const link = await resolveTrackingOrderLink({
    externalOrderId: input.snapshot.orderId,
    emailOrderImportId: input.emailOrderImportId
  });
  const evidenceDate = parseDate(input.snapshot.orderDate)
    ?? extractPortalEvidenceDateFromText(sourceText)
    ?? link.orderDate;
  if (evidenceDate && evidenceDate < subtractMonths(now, recentMonths)) {
    return { saved: 0, updated: 0, skipped: 1, records: [] };
  }

  const trackingNumbers = unique([
    ...(input.snapshot.trackingNumbers ?? []),
    ...extractTrackingNumbersFromText(sourceText)
  ]
    .map(normalizeTrackingNumber)
    .filter((value) => looksLikeTrackingNumber(value) && !excluded.has(value)));

  let saved = 0;
  let updated = 0;
  let skipped = 0;
  const records = [];
  const linkedPurchaseOrderIds = new Set<string>();

  const source = input.source ?? "ALIBABA_PORTAL";

  for (const trackingNumber of trackingNumbers) {
    const existing = await prisma.trackingNumber.findUnique({ where: { trackingNumber } });
    const data = {
      carrier: inferCarrier(trackingNumber),
      provider: "UNCONFIGURED",
      source,
      sourceUrl: input.snapshot.sourceUrl,
      externalOrderId: input.snapshot.orderId ?? link.externalOrderId,
      supplierName: input.snapshot.supplierName ?? link.supplierName,
      purchaseOrderId: link.purchaseOrderId,
      emailOrderImportId: link.emailOrderImportId,
      capturedAt,
      refreshStatus: "PENDING",
      nextRefreshAt: existing?.nextRefreshAt ?? capturedAt
    };

    if (!existing) {
      const created = await prisma.trackingNumber.create({ data: { trackingNumber, ...data } });
      await writeAuditLog({
        actorType: "AGENT",
        actorId: input.actorId,
        action: "CAPTURE_TRACKING_NUMBER",
        entityType: "TrackingNumber",
        entityId: created.id,
        payload: {
          trackingNumber,
          source,
          externalOrderId: created.externalOrderId,
          purchaseOrderId: created.purchaseOrderId,
          emailOrderImportId: created.emailOrderImportId,
          sourceUrl: created.sourceUrl
        }
      });
      records.push(created);
      if (created.purchaseOrderId) linkedPurchaseOrderIds.add(created.purchaseOrderId);
      saved += 1;
      continue;
    }

    const merged = await prisma.trackingNumber.update({
      where: { id: existing.id },
      data: {
        carrier: existing.carrier ?? data.carrier,
        source: existing.source,
        sourceUrl: existing.sourceUrl ?? data.sourceUrl,
        externalOrderId: existing.externalOrderId ?? data.externalOrderId,
        supplierName: existing.supplierName ?? data.supplierName,
        purchaseOrderId: existing.purchaseOrderId ?? data.purchaseOrderId,
        emailOrderImportId: existing.emailOrderImportId ?? data.emailOrderImportId,
        refreshStatus: existing.refreshStatus === "UNKNOWN" ? "PENDING" : existing.refreshStatus,
        nextRefreshAt: existing.currentStatus === "DELIVERED" ? null : existing.nextRefreshAt ?? data.nextRefreshAt
      }
    });
    records.push(merged);
    if (merged.purchaseOrderId) linkedPurchaseOrderIds.add(merged.purchaseOrderId);
    updated += 1;
  }

  for (const purchaseOrderId of linkedPurchaseOrderIds) {
    await syncLeadTimeAveragesForPurchaseOrder(purchaseOrderId, input.actorId, "AGENT");
  }

  if (trackingNumbers.length === 0) skipped += 1;
  return { saved, updated, skipped, records };
}

export async function pruneOldAlibabaTrackingNumbers(input: { actorId: string; now?: Date; recentMonths?: number; sourceUrlContains?: string }) {
  const now = input.now ?? new Date();
  const cutoff = subtractMonths(now, input.recentMonths ?? 3);
  const rows = await prisma.trackingNumber.findMany({
    where: {
      source: { in: ["ALIBABA_PORTAL", "ALIBABA_PORTAL_UIAUTOMATION"] },
      ...(input.sourceUrlContains ? { sourceUrl: { contains: input.sourceUrlContains } } : {}),
      emailOrderImport: { orderDate: { lt: cutoff } }
    },
    select: {
      id: true,
      trackingNumber: true,
      source: true,
      sourceUrl: true,
      externalOrderId: true,
      purchaseOrderId: true,
      emailOrderImportId: true,
      emailOrderImport: { select: { orderDate: true } }
    }
  });

  for (const row of rows) {
    await writeAuditLog({
      actorType: "AGENT",
      actorId: input.actorId,
      action: "PRUNE_OLD_ALIBABA_TRACKING_NUMBER",
      entityType: "TrackingNumber",
      entityId: row.id,
      payload: {
        trackingNumber: row.trackingNumber,
        source: row.source,
        sourceUrl: row.sourceUrl,
        externalOrderId: row.externalOrderId,
        purchaseOrderId: row.purchaseOrderId,
        emailOrderImportId: row.emailOrderImportId,
        orderDate: row.emailOrderImport?.orderDate?.toISOString(),
        cutoff: cutoff.toISOString()
      }
    });
    await prisma.trackingNumber.delete({ where: { id: row.id } });
  }

  return { pruned: rows.length, cutoff };
}

export async function captureTrackingNumbersFromImports(input: { actorId: string; limit?: number; now?: Date; recentMonths?: number } = { actorId: "tracking-agent" }) {
  const imports = await prisma.emailOrderImport.findMany({
    where: {
      OR: [
        { rawText: { contains: "Tracking" } },
        { rawText: { contains: "tracking" } },
        { rawText: { contains: "Track" } },
        { rawText: { contains: "track" } },
        { rawText: { contains: "Logistics" } },
        { rawText: { contains: "logistics" } }
      ]
    },
    orderBy: { updatedAt: "desc" },
    take: input.limit ?? 100
  });

  let saved = 0;
  let updated = 0;
  let skipped = 0;
  for (const orderImport of imports) {
    const trackingNumbers = extractTrackingNumbersFromText(orderImport.rawText);
    if (trackingNumbers.length === 0) {
      skipped += 1;
      continue;
    }
    const result = await captureTrackingNumbersFromPortalSnapshot({
      actorId: input.actorId,
      emailOrderImportId: orderImport.id,
      now: input.now,
      recentMonths: input.recentMonths,
      snapshot: {
        sourceUrl: orderImport.sourceUrl ?? `email-order-import:${orderImport.id}`,
        capturedAt: orderImport.updatedAt.toISOString(),
        subject: orderImport.subject ?? undefined,
        messageId: orderImport.sourceMessageId ?? undefined,
        orderId: orderImport.externalOrderId ?? undefined,
        orderDate: orderImport.orderDate?.toISOString(),
        supplierName: orderImport.supplierName,
        trackingNumbers,
        text: orderImport.rawText
      },
      source: orderImport.source || "EMAIL_IMPORT"
    });
    saved += result.saved;
    updated += result.updated;
    skipped += result.skipped;
  }

  return { scanned: imports.length, saved, updated, skipped };
}

export async function refreshTrackingNumber(input: {
  trackingNumber: string;
  actorId: string;
  now?: Date;
  config?: TrackingServiceConfig;
  fetcher?: FetchLike;
}) {
  const now = input.now ?? new Date();
  const config = mergeTrackingServiceConfig(input.config);
  config.provider = normalizeProviderName(config.provider);
  const normalized = normalizeTrackingNumber(input.trackingNumber);
  const existing = await prisma.trackingNumber.findUniqueOrThrow({ where: { trackingNumber: normalized } });
  if (!isActiveTrackingStatus(existing.currentStatus)) return existing;

  if (!isTrackingServiceConfigured(config)) {
    const updated = await prisma.trackingNumber.update({
      where: { id: existing.id },
      data: {
        provider: config.provider ?? "UNCONFIGURED",
        refreshStatus: "CONFIG_REQUIRED",
        refreshError: trackingConfigurationMessage(config),
        lastCheckedAt: now,
        nextRefreshAt: addMinutes(now, config.refreshIntervalMinutes ?? DEFAULT_REFRESH_INTERVAL_MINUTES)
      }
    });
    return updated;
  }

  try {
    const response = await fetchTrackingStatus(existing, config, input.fetcher ?? fetch);
    const body = response.body;
    const normalizedStatus = response.normalizedStatus;
    const status = normalizeTrackingStatusFromEvidence(
      normalizedStatus.currentStatus ?? existing.currentStatus,
      normalizedStatus.statusDescription,
      normalizedStatus.events
    );
    const deliveredAt = normalizedStatus.deliveredAt ?? (status === "DELIVERED" ? normalizedStatus.lastEventAt ?? now : null);
    const updated = await prisma.trackingNumber.update({
      where: { id: existing.id },
      data: {
        carrier: normalizedStatus.carrier ?? existing.carrier,
        provider: config.provider ?? "CUSTOM_HTTP",
        currentStatus: status,
        statusDescription: normalizedStatus.statusDescription ?? existing.statusDescription,
        origin: normalizedStatus.origin ?? existing.origin,
        destination: normalizedStatus.destination ?? existing.destination,
        lastEventAt: normalizedStatus.lastEventAt ?? existing.lastEventAt,
        deliveredAt: deliveredAt ?? existing.deliveredAt,
        lastCheckedAt: now,
        nextRefreshAt: status === "DELIVERED" ? null : addMinutes(now, config.refreshIntervalMinutes ?? DEFAULT_REFRESH_INTERVAL_MINUTES),
        refreshStatus: "SUCCESS",
        refreshError: null,
        rawStatusJson: toJson(body)
      }
    });

    await persistTrackingEvents(updated.id, normalizedStatus.events);
    await writeAuditLog({
      actorType: "AGENT",
      actorId: input.actorId,
      action: "REFRESH_TRACKING_NUMBER",
      entityType: "TrackingNumber",
      entityId: updated.id,
      payload: {
        trackingNumber: updated.trackingNumber,
        provider: updated.provider,
        currentStatus: updated.currentStatus,
        lastEventAt: updated.lastEventAt,
        deliveredAt: updated.deliveredAt
      }
    });
    if (status === "DELIVERED") {
      await archiveAssociatedActiveTrackingNumbers({ delivered: updated, actorId: input.actorId, actorType: "AGENT", now });
    }
    if (updated.purchaseOrderId) {
      await syncLeadTimeAveragesForPurchaseOrder(updated.purchaseOrderId, input.actorId, "AGENT");
    }
    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const updated = await prisma.trackingNumber.update({
      where: { id: existing.id },
      data: {
        provider: config.provider ?? "CUSTOM_HTTP",
        refreshStatus: "FAILED",
        refreshError: message.slice(0, 1000),
        lastCheckedAt: now,
        nextRefreshAt: addMinutes(now, config.refreshIntervalMinutes ?? DEFAULT_REFRESH_INTERVAL_MINUTES)
      }
    });
    await writeAuditLog({
      actorType: "AGENT",
      actorId: input.actorId,
      action: "REFRESH_TRACKING_NUMBER_FAILED",
      entityType: "TrackingNumber",
      entityId: updated.id,
      payload: { trackingNumber: updated.trackingNumber, provider: updated.provider, error: message.slice(0, 1000) }
    });
    return updated;
  }
}

export async function archiveTrackingNumber(input: {
  trackingNumber: string;
  actorId: string;
  reason?: string;
}) {
  const trackingNumber = normalizeTrackingNumber(input.trackingNumber);
  const existing = await prisma.trackingNumber.findUniqueOrThrow({ where: { trackingNumber } });
  if (!isActiveTrackingStatus(existing.currentStatus)) {
    throw new Error("Only active tracking numbers can be archived from the tracking workbench.");
  }
  const reason = blankToUndefined(input.reason) ?? "Archived manually from the tracking workbench.";
  const updated = await prisma.trackingNumber.update({
    where: { id: existing.id },
    data: {
      currentStatus: "ARCHIVED",
      statusDescription: reason,
      nextRefreshAt: null,
      refreshStatus: "ARCHIVED",
      refreshError: null
    }
  });
  await writeAuditLog({
    actorType: "USER",
    actorId: input.actorId,
    action: "ARCHIVE_TRACKING_NUMBER",
    entityType: "TrackingNumber",
    entityId: existing.id,
    payload: trackingNumberSnapshot(existing, { reason })
  });
  return updated;
}

export async function deleteTrackingNumber(input: {
  trackingNumber: string;
  actorId: string;
  reason?: string;
}) {
  const trackingNumber = normalizeTrackingNumber(input.trackingNumber);
  const existing = await prisma.trackingNumber.findUniqueOrThrow({
    where: { trackingNumber },
    include: { _count: { select: { events: true } } }
  });
  if (!isActiveTrackingStatus(existing.currentStatus)) {
    throw new Error("Only active tracking numbers can be deleted from the tracking workbench.");
  }
  const reason = blankToUndefined(input.reason) ?? "Deleted manually from the tracking workbench.";
  await writeAuditLog({
    actorType: "USER",
    actorId: input.actorId,
    action: "DELETE_TRACKING_NUMBER",
    entityType: "TrackingNumber",
    entityId: existing.id,
    payload: trackingNumberSnapshot(existing, { reason, eventCount: existing._count.events })
  });
  await prisma.trackingNumber.delete({ where: { id: existing.id } });
  return existing;
}

async function archiveAssociatedActiveTrackingNumbers(input: {
  delivered: {
    id: string;
    trackingNumber: string;
    externalOrderId: string | null;
    purchaseOrderId: string | null;
  };
  actorId: string;
  actorType: "USER" | "AGENT";
  now: Date;
}) {
  const linkedBy = [
    input.delivered.externalOrderId ? { externalOrderId: input.delivered.externalOrderId } : null,
    input.delivered.purchaseOrderId ? { purchaseOrderId: input.delivered.purchaseOrderId } : null
  ].filter((value): value is { externalOrderId: string } | { purchaseOrderId: string } => Boolean(value));
  if (linkedBy.length === 0) return [];

  const siblings = await prisma.trackingNumber.findMany({
    where: {
      id: { not: input.delivered.id },
      OR: linkedBy,
      NOT: { currentStatus: { in: ["DELIVERED", "ARCHIVED"] } }
    }
  });
  const archived = [];
  for (const sibling of siblings.filter((row) => isActiveTrackingStatus(row.currentStatus))) {
    const reason = `Archived automatically because associated active tracking number ${input.delivered.trackingNumber} was marked delivered.`;
    const updated = await prisma.trackingNumber.update({
      where: { id: sibling.id },
      data: {
        currentStatus: "ARCHIVED",
        statusDescription: reason,
        nextRefreshAt: null,
        refreshStatus: "ARCHIVED",
        refreshError: null
      }
    });
    archived.push(updated);
    await writeAuditLog({
      actorType: input.actorType,
      actorId: input.actorId,
      action: "AUTO_ARCHIVE_ASSOCIATED_TRACKING_NUMBER",
      entityType: "TrackingNumber",
      entityId: sibling.id,
      payload: trackingNumberSnapshot(sibling, {
        reason,
        deliveredTrackingNumber: input.delivered.trackingNumber,
        deliveredTrackingNumberId: input.delivered.id,
        archivedAt: input.now.toISOString()
      })
    });
  }
  return archived;
}

function trackingNumberSnapshot(row: {
  id: string;
  trackingNumber: string;
  currentStatus: string;
  refreshStatus: string;
  externalOrderId: string | null;
  purchaseOrderId: string | null;
  emailOrderImportId: string | null;
  source: string;
  sourceUrl: string | null;
}, extra: Record<string, unknown> = {}) {
  return {
    trackingNumber: row.trackingNumber,
    previousStatus: row.currentStatus,
    previousRefreshStatus: row.refreshStatus,
    externalOrderId: row.externalOrderId,
    purchaseOrderId: row.purchaseOrderId,
    emailOrderImportId: row.emailOrderImportId,
    source: row.source,
    sourceUrl: row.sourceUrl,
    ...extra
  };
}

export async function refreshDueTrackingNumbers(input: {
  actorId: string;
  now?: Date;
  limit?: number;
  config?: TrackingServiceConfig;
  fetcher?: FetchLike;
}) {
  return refreshTrackingRows({ ...input, dueOnly: true, limit: input.limit ?? 25 });
}

export async function refreshActiveTrackingNumbers(input: {
  actorId: string;
  now?: Date;
  limit?: number;
  config?: TrackingServiceConfig;
  fetcher?: FetchLike;
}) {
  return refreshTrackingRows({ ...input, dueOnly: false, limit: input.limit ?? 100 });
}

async function refreshTrackingRows(input: {
  actorId: string;
  now?: Date;
  limit: number;
  dueOnly: boolean;
  config?: TrackingServiceConfig;
  fetcher?: FetchLike;
}) {
  const now = input.now ?? new Date();
  const activeWhere = activeTrackingNumberWhere();
  const totalCandidates = await prisma.trackingNumber.count({ where: activeWhere });
  const rows = await prisma.trackingNumber.findMany({
    where: {
      ...activeWhere,
      ...(input.dueOnly ? { OR: [{ nextRefreshAt: null }, { nextRefreshAt: { lte: now } }] } : {})
    },
    orderBy: input.dueOnly ? [{ nextRefreshAt: "asc" }, { updatedAt: "asc" }] : [{ updatedAt: "desc" }, { capturedAt: "desc" }],
    take: input.limit
  });

  let refreshed = 0;
  let failed = 0;
  for (const row of rows) {
    const result = await refreshTrackingNumber({
      trackingNumber: row.trackingNumber,
      actorId: input.actorId,
      now,
      config: input.config,
      fetcher: input.fetcher
    });
    if (result.refreshStatus === "SUCCESS" || result.refreshStatus === "CONFIG_REQUIRED") refreshed += 1;
    else failed += 1;
  }
  return { scanned: rows.length, refreshed, failed, skipped: Math.max(0, totalCandidates - rows.length) };
}

export async function getTrackingDashboard(input: { now?: Date; config?: TrackingServiceConfig } = {}) {
  const now = input.now ?? new Date();
  const config = mergeTrackingServiceConfig(input.config);
  const rows = await prisma.trackingNumber.findMany({
    orderBy: [{ currentStatus: "asc" }, { updatedAt: "desc" }],
    include: {
      purchaseOrder: {
        include: {
          supplier: true,
          emailOrderImports: { select: { orderDate: true } },
          lines: {
            include: {
              stockMovements: {
                where: { movementType: MovementType.RECEIVE },
                include: { stockLot: { select: { receivedAt: true } } }
              }
            }
          }
        }
      },
      emailOrderImport: true,
      events: { orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }] }
    }
  });

  const mappedRows: TrackingDashboardRow[] = rows.map((row) => {
    const shipTime = computeDeliveredShipTime(row);
    const leadTime = computeTrackingLeadTime(row);
    return {
      id: row.id,
      trackingNumber: row.trackingNumber,
      carrier: row.carrier,
      provider: row.provider,
      currentStatus: normalizeTrackingStatusFromEvidence(row.currentStatus, row.statusDescription, row.events),
      statusDescription: row.statusDescription,
      refreshStatus: row.refreshStatus,
      refreshError: row.refreshError,
      externalOrderId: row.externalOrderId,
      purchaseOrderId: row.purchaseOrderId,
      emailOrderImportId: row.emailOrderImportId,
      linkedOrderLabel: buildLinkedOrderLabel(row),
      supplierName: displayTrackingSupplierName(row.purchaseOrder?.supplier.name ?? row.emailOrderImport?.supplierName ?? row.supplierName),
      source: row.source,
      sourceUrl: row.sourceUrl,
      lastEventAt: row.lastEventAt,
      deliveredAt: row.deliveredAt,
      lastCheckedAt: row.lastCheckedAt,
      nextRefreshAt: row.currentStatus === "DELIVERED" ? null : row.nextRefreshAt,
      capturedAt: row.capturedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      paymentStartAt: leadTime.startAt,
      leadTimeEndAt: leadTime.endAt,
      leadTimeEndSource: leadTime.endSource,
      leadTimeDays: leadTime.days,
      leadTimeLabel: leadTime.label,
      shipTimeStartedAt: shipTime.startedAt,
      shipTimeEndedAt: shipTime.endedAt,
      shipTimeMs: shipTime.ms,
      shipTimeLabel: shipTime.label,
      eventCount: row.events.length,
      latestEvent: row.events[0]
        ? { description: row.events[0].description, location: row.events[0].location, occurredAt: row.events[0].occurredAt }
        : null,
      relatedTrackingNumbers: [row.trackingNumber],
      screenedShipmentCount: 1,
      events: row.events.map((event) => ({
        id: event.id,
        status: event.status,
        description: event.description,
        location: event.location,
        occurredAt: event.occurredAt,
        createdAt: event.createdAt,
        rawEventJson: event.rawEventJson
      })),
      rawStatusJson: row.rawStatusJson
    };
  });

  const rowsWithRelated = annotateRelatedTrackingNumbers(mappedRows);
  const activeRows = screenDuplicateOrderShipments(rowsWithRelated.filter((row) => isActiveTrackingStatus(row.currentStatus)));
  const deliveredRows = rowsWithRelated.filter((row) => row.currentStatus === "DELIVERED");
  const archivedRows = rowsWithRelated.filter((row) => row.currentStatus === "ARCHIVED");

  return {
    service: {
      configured: isTrackingServiceConfigured(config),
      provider: config.provider ?? (config.urlTemplate ? "CUSTOM_HTTP" : "UNCONFIGURED"),
      refreshIntervalMinutes: config.refreshIntervalMinutes ?? DEFAULT_REFRESH_INTERVAL_MINUTES,
      lastCheckedAt: trackingHeartbeatFromRows(mappedRows, now).lastCheckedAt,
      nextRefreshAt: trackingHeartbeatFromRows(mappedRows, now).nextRefreshAt
    },
    summary: {
      total: rows.length,
      due: rows.filter((row) => isActiveTrackingStatus(row.currentStatus) && (!row.nextRefreshAt || row.nextRefreshAt <= now)).length,
      delivered: rows.filter((row) => row.currentStatus === "DELIVERED").length,
      archived: rows.filter((row) => row.currentStatus === "ARCHIVED").length,
      needsConfiguration: rows.filter((row) => row.refreshStatus === "CONFIG_REQUIRED").length,
      failed: rows.filter((row) => row.refreshStatus === "FAILED").length
    },
    rows: activeRows,
    deliveredRows,
    archivedRows
  };
}

function annotateRelatedTrackingNumbers(rows: TrackingDashboardRow[]) {
  const grouped = new Map<string, TrackingDashboardRow[]>();
  for (const row of rows) {
    const key = duplicateShipmentOrderKey(row);
    if (!key) continue;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  const relatedById = new Map<string, { relatedTrackingNumbers: string[]; screenedShipmentCount: number }>();
  for (const group of grouped.values()) {
    if (group.length <= 1) continue;
    const relatedTrackingNumbers = [...group]
      .sort((left, right) => {
        const firstSeenDelta = trackingRowFirstSeenTime(left) - trackingRowFirstSeenTime(right);
        return firstSeenDelta === 0 ? left.trackingNumber.localeCompare(right.trackingNumber) : firstSeenDelta;
      })
      .map((row) => row.trackingNumber);
    for (const row of group) relatedById.set(row.id, { relatedTrackingNumbers, screenedShipmentCount: group.length });
  }

  return rows.map((row) => {
    const related = relatedById.get(row.id);
    return related ? { ...row, ...related } : row;
  });
}

function screenDuplicateOrderShipments(rows: TrackingDashboardRow[]) {
  const grouped = new Map<string, TrackingDashboardRow[]>();
  const ungrouped: TrackingDashboardRow[] = [];
  for (const row of rows) {
    const key = duplicateShipmentOrderKey(row);
    if (!key) {
      ungrouped.push(row);
      continue;
    }
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  const screened = [...ungrouped];
  for (const group of grouped.values()) {
    if (group.length === 1) {
      screened.push(group[0]);
      continue;
    }
    const selected = newestActiveShipmentRow(group);
    screened.push({
      ...selected,
      relatedTrackingNumbers: selected.relatedTrackingNumbers.length > 0 ? selected.relatedTrackingNumbers : group.map((row) => row.trackingNumber),
      screenedShipmentCount: Math.max(selected.screenedShipmentCount, group.length)
    });
  }

  return screened.sort((left, right) => trackingRowSortTime(right) - trackingRowSortTime(left));
}

function duplicateShipmentOrderKey(row: TrackingDashboardRow) {
  if (row.externalOrderId) return `external:${row.externalOrderId}`;
  if (row.purchaseOrderId) return `po:${row.purchaseOrderId}`;
  return null;
}

function newestActiveShipmentRow(rows: TrackingDashboardRow[]) {
  return [...rows].sort((left, right) => {
    const activityDelta = trackingRowActivityTime(right) - trackingRowActivityTime(left);
    if (activityDelta !== 0) return activityDelta;
    const eventCountDelta = right.eventCount - left.eventCount;
    if (eventCountDelta !== 0) return eventCountDelta;
    return trackingRowSortTime(right) - trackingRowSortTime(left);
  })[0];
}

function trackingRowActivityTime(row: TrackingDashboardRow) {
  return row.latestEvent?.occurredAt?.getTime()
    ?? row.lastEventAt?.getTime()
    ?? (row.eventCount > 0 ? row.updatedAt.getTime() : 0);
}

function trackingRowSortTime(row: TrackingDashboardRow) {
  return trackingRowActivityTime(row) || row.capturedAt.getTime() || row.updatedAt.getTime() || row.createdAt.getTime();
}

function trackingRowFirstSeenTime(row: TrackingDashboardRow) {
  return row.capturedAt.getTime() || row.createdAt.getTime();
}

export async function getTrackingRefreshHeartbeat(input: { now?: Date; config?: TrackingServiceConfig } = {}) {
  const now = input.now ?? new Date();
  const rows = await prisma.trackingNumber.findMany({
    where: activeTrackingNumberWhere(),
    select: { currentStatus: true, lastCheckedAt: true, nextRefreshAt: true }
  });
  return trackingHeartbeatFromRows(rows, now);
}

function trackingHeartbeatFromRows(
  rows: Array<{ currentStatus: string; lastCheckedAt: Date | null; nextRefreshAt: Date | null }>,
  now: Date
) {
  const refreshableRows = rows.filter((row) => isActiveTrackingStatus(row.currentStatus));
  const lastCheckedAt = maxDate(refreshableRows.map((row) => row.lastCheckedAt));
  const hasDueNow = refreshableRows.some((row) => !row.nextRefreshAt || row.nextRefreshAt <= now);
  const futureNextRefreshAt = minDate(refreshableRows.map((row) => row.nextRefreshAt).filter((value): value is Date => Boolean(value)));
  return {
    lastCheckedAt,
    nextRefreshAt: refreshableRows.length === 0 ? null : (hasDueNow ? now : futureNextRefreshAt)
  };
}

function isActiveTrackingStatus(status: string) {
  const normalized = normalizeTrackingStatus(status);
  return normalized !== "DELIVERED" && normalized !== "ARCHIVED";
}

function activeTrackingNumberWhere() {
  return { NOT: { currentStatus: { in: ["DELIVERED", "ARCHIVED"] } } };
}

function minDate(values: Date[]) {
  if (values.length === 0) return null;
  return values.reduce((earliest, value) => value < earliest ? value : earliest, values[0]);
}

function maxDate(values: Array<Date | null>) {
  const dates = values.filter((value): value is Date => Boolean(value));
  if (dates.length === 0) return null;
  return dates.reduce((latest, value) => value > latest ? value : latest, dates[0]);
}

export async function getLeadTimeSummaryIndex(): Promise<LeadTimeSummaryIndex> {
  const samples = await buildLeadTimeSamples();
  return {
    byItemId: summarizeLeadTimes(samples, "itemId"),
    bySupplierId: summarizeLeadTimes(samples, "supplierId")
  };
}

export async function getLeadTimeLog(): Promise<LeadTimeLog> {
  const [samples, activeItems] = await Promise.all([
    buildLeadTimeSamples(),
    prisma.item.findMany({
      where: { lifecycleStatus: { not: "OBSOLETE" } },
      select: { id: true, sku: true, description: true, leadTimeDays: true, manualLeadTimeDays: true },
      orderBy: { sku: "asc" }
    })
  ]);
  const grouped = new Map<string, LeadTimeSample[]>();
  for (const sample of samples) {
    grouped.set(sample.itemId, [...(grouped.get(sample.itemId) ?? []), sample]);
  }

  const items: LeadTimeLogItem[] = activeItems
    .map((item) => {
      const group = grouped.get(item.id);
      if (group?.length) return buildLeadTimeLogItem(group);
      return buildManualLeadTimeLogItem(item);
    })
    .sort((a, b) => b.currentLeadTimeDays - a.currentLeadTimeDays || a.itemSku.localeCompare(b.itemSku));
  const totalQuantityOrdered = samples.reduce((sum, sample) => sum + sample.quantityOrdered, 0);
  const averageLeadTimeDays = samples.length > 0
    ? roundDays(samples.reduce((sum, sample) => sum + sample.days, 0) / samples.length)
    : null;
  const shippingSamples = samples.filter((sample) => sample.shipTimeMs !== null);
  const averageShipTimeDays = shippingSamples.length > 0
    ? roundDays(shippingSamples.reduce((sum, sample) => sum + (sample.shipTimeMs ?? 0) / 86_400_000, 0) / shippingSamples.length)
    : null;

  return {
    sampleCount: samples.length,
    itemCount: items.length,
    totalQuantityOrdered,
    averageLeadTimeDays,
    averageShipTimeDays,
    items
  };
}

export async function updateManualItemLeadTime(input: { itemId: string; leadTimeDays: number; actorId: string }) {
  const leadTimeDays = Math.max(0, Math.round(input.leadTimeDays));
  const item = await prisma.item.findUnique({
    where: { id: input.itemId },
    select: { id: true, sku: true, leadTimeDays: true, manualLeadTimeDays: true, preferredSupplierId: true }
  });
  if (!item) throw new Error("Item not found.");
  if (item.leadTimeDays === leadTimeDays && item.manualLeadTimeDays === leadTimeDays) {
    if (item.preferredSupplierId) await syncPreferredSupplierLeadTimeFromItem({ supplierId: item.preferredSupplierId, itemId: item.id, sku: item.sku, leadTimeDays, previousItemLeadTimeDays: item.leadTimeDays, actorId: input.actorId });
    return item;
  }

  const updated = await prisma.item.update({
    where: { id: item.id },
    data: { leadTimeDays, manualLeadTimeDays: leadTimeDays },
    select: { id: true, sku: true, leadTimeDays: true, preferredSupplierId: true }
  });
  await writeAuditLog({
    actorType: "USER",
    actorId: input.actorId,
    action: "UPDATE_ITEM_MANUAL_LEAD_TIME",
    entityType: "Item",
    entityId: item.id,
    payload: {
      sku: item.sku,
      previousLeadTimeDays: item.leadTimeDays,
      newLeadTimeDays: leadTimeDays,
      boundary: "Manual planning lead time only; no purchase order, tracking, accounting, or stock movement was mutated. Manual lead time is primary for item planning; observed receiving/tracking samples are retained as evidence but do not overwrite this item while a manual value is recorded."
    }
  });
  if (updated.preferredSupplierId) {
    await syncPreferredSupplierLeadTimeFromItem({ supplierId: updated.preferredSupplierId, itemId: updated.id, sku: updated.sku, leadTimeDays, previousItemLeadTimeDays: item.leadTimeDays, actorId: input.actorId });
  }
  return updated;
}

async function syncPreferredSupplierLeadTimeFromItem(input: { supplierId: string; itemId: string; sku: string; leadTimeDays: number; previousItemLeadTimeDays: number; actorId: string }) {
  const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true, leadTimeDays: true } });
  if (!supplier || supplier.leadTimeDays === input.leadTimeDays) return false;
  await prisma.supplier.update({ where: { id: supplier.id }, data: { leadTimeDays: input.leadTimeDays } });
  await writeAuditLog({
    actorType: "USER",
    actorId: input.actorId,
    action: "UPDATE_SUPPLIER_LEAD_TIME_FROM_ITEM_MANUAL_LEAD_TIME",
    entityType: "Supplier",
    entityId: supplier.id,
    payload: {
      sourceItemId: input.itemId,
      sourceSku: input.sku,
      previousSupplierLeadTimeDays: supplier.leadTimeDays,
      newSupplierLeadTimeDays: input.leadTimeDays,
      previousItemLeadTimeDays: input.previousItemLeadTimeDays,
      boundary: "Mirrors the item manual planning lead time onto the preferred supplier record for operator visibility. No purchase order, tracking refresh, accounting, or stock movement was mutated."
    }
  });
  return true;
}

export async function syncLeadTimeAveragesForPurchaseOrder(
  purchaseOrderId: string,
  actorId: string,
  actorType: "USER" | "AGENT" = "AGENT"
) {
  const order = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: { supplierId: true, lines: { select: { itemId: true } } }
  });
  if (!order) return { updatedItems: 0, updatedSuppliers: 0 };

  const samples = await buildLeadTimeSamples();
  const supplierSummaries = summarizeLeadTimes(samples, "supplierId");
  const itemSummaries = summarizeLeadTimes(samples, "itemId");
  let updatedSuppliers = 0;
  let updatedItems = 0;

  const supplierSummary = supplierSummaries[order.supplierId];
  if (supplierSummary) {
    const supplier = await prisma.supplier.findUnique({ where: { id: order.supplierId }, select: { id: true, leadTimeDays: true } });
    if (supplier && supplier.leadTimeDays !== supplierSummary.roundedDays) {
      await prisma.supplier.update({ where: { id: supplier.id }, data: { leadTimeDays: supplierSummary.roundedDays } });
      await writeAuditLog({
        actorType,
        actorId,
        action: "UPDATE_SUPPLIER_LEAD_TIME_FROM_TRACKING_HISTORY",
        entityType: "Supplier",
        entityId: supplier.id,
        payload: {
          previousLeadTimeDays: supplier.leadTimeDays,
          newLeadTimeDays: supplierSummary.roundedDays,
          averageDays: supplierSummary.averageDays,
          sampleCount: supplierSummary.sampleCount,
          sourcePurchaseOrderId: purchaseOrderId
        }
      });
      updatedSuppliers += 1;
    }
  }

  for (const itemId of unique(order.lines.map((line) => line.itemId))) {
    const summary = itemSummaries[itemId];
    if (!summary) continue;
    const item = await prisma.item.findUnique({ where: { id: itemId }, select: { id: true, leadTimeDays: true, manualLeadTimeDays: true } });
    if (!item || item.manualLeadTimeDays !== null || item.leadTimeDays === summary.roundedDays) continue;
    await prisma.item.update({ where: { id: item.id }, data: { leadTimeDays: summary.roundedDays } });
    await writeAuditLog({
      actorType,
      actorId,
      action: "UPDATE_ITEM_LEAD_TIME_FROM_TRACKING_HISTORY",
      entityType: "Item",
      entityId: item.id,
      payload: {
        previousLeadTimeDays: item.leadTimeDays,
        newLeadTimeDays: summary.roundedDays,
        averageDays: summary.averageDays,
        sampleCount: summary.sampleCount,
        sourcePurchaseOrderId: purchaseOrderId
      }
    });
    updatedItems += 1;
  }

  return { updatedItems, updatedSuppliers };
}

function computeDeliveredShipTime(row: {
  currentStatus: string;
  deliveredAt: Date | null;
  lastEventAt: Date | null;
  capturedAt: Date;
  events: Array<{ occurredAt: Date | null }>;
}) {
  const endedAt = row.currentStatus === "DELIVERED" ? row.deliveredAt ?? row.lastEventAt : null;
  if (!endedAt) return { startedAt: null, endedAt: null, ms: null, label: null };

  const datedEvents = row.events
    .map((event) => event.occurredAt)
    .filter((value): value is Date => Boolean(value));
  const earliestEvent = datedEvents.length > 0
    ? datedEvents.reduce((earliest, value) => (value < earliest ? value : earliest), datedEvents[0])
    : null;
  const fallbackCapturedAt = row.capturedAt <= endedAt ? row.capturedAt : null;
  const startedAt = earliestEvent ?? fallbackCapturedAt;
  if (!startedAt || endedAt < startedAt) return { startedAt: null, endedAt, ms: null, label: null };

  const ms = endedAt.getTime() - startedAt.getTime();
  return { startedAt, endedAt, ms, label: formatShipTime(ms) };
}

function formatShipTime(milliseconds: number) {
  const totalHours = Math.max(0, Math.round(milliseconds / 3_600_000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0 && hours > 0) return `${days}d ${hours}h`;
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  return "<1h";
}

type LeadTimeSample = {
  purchaseOrderId: string;
  supplierId: string;
  supplierName: string;
  itemId: string;
  itemSku: string;
  itemDescription: string;
  itemLeadTimeDays: number;
  itemManualLeadTimeDays: number | null;
  externalOrderId: string | null;
  quantityOrdered: number;
  quantityReceived: number;
  startAt: Date;
  endAt: Date;
  endSource: "RECEIVED" | "DELIVERED";
  days: number;
  trackingNumbers: string[];
  shipTimeStartedAt: Date | null;
  shipTimeEndedAt: Date | null;
  shipTimeMs: number | null;
  shipTimeLabel: string | null;
};

async function buildLeadTimeSamples(): Promise<LeadTimeSample[]> {
  const orders = await prisma.purchaseOrder.findMany({
    include: {
      supplier: { select: { id: true, name: true } },
      emailOrderImports: { select: { externalOrderId: true, orderDate: true } },
      trackingNumbers: {
        select: {
          trackingNumber: true,
          deliveredAt: true,
          currentStatus: true,
          lastEventAt: true,
          capturedAt: true,
          events: {
            select: { occurredAt: true },
            orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }]
          }
        }
      },
      lines: {
        include: {
          item: { select: { id: true, sku: true, description: true, leadTimeDays: true, manualLeadTimeDays: true } },
          stockMovements: {
            where: { movementType: MovementType.RECEIVE },
            include: { stockLot: { select: { receivedAt: true } } }
          }
        }
      }
    }
  });
  const samples: LeadTimeSample[] = [];
  for (const order of orders) {
    const startAt = earliestDate([
      ...order.emailOrderImports.map((entry) => entry.orderDate),
      order.orderedAt
    ]);
    if (!startAt) continue;
    const deliveredAt = earliestDate(order.trackingNumbers
      .filter((tracking) => tracking.currentStatus === "DELIVERED" || tracking.deliveredAt)
      .map((tracking) => tracking.deliveredAt ?? tracking.lastEventAt));
    const shipTime = computeOrderShipTime(order.trackingNumbers);
    const externalOrderId = order.emailOrderImports.find((entry) => entry.externalOrderId)?.externalOrderId ?? null;
    const trackingNumbers = unique(order.trackingNumbers.map((tracking) => tracking.trackingNumber));
    for (const line of order.lines) {
      const receivedAt = earliestDate(line.stockMovements.map((movement) => movement.stockLot?.receivedAt ?? movement.createdAt));
      const endAt = receivedAt ?? deliveredAt;
      if (!endAt || endAt < startAt) continue;
      samples.push({
        purchaseOrderId: order.id,
        supplierId: order.supplierId,
        supplierName: order.supplier.name,
        itemId: line.itemId,
        itemSku: line.item.sku,
        itemDescription: line.item.description,
        itemLeadTimeDays: line.item.manualLeadTimeDays ?? line.item.leadTimeDays,
        itemManualLeadTimeDays: line.item.manualLeadTimeDays,
        externalOrderId,
        quantityOrdered: line.quantity,
        quantityReceived: line.receivedQuantity,
        startAt,
        endAt,
        endSource: receivedAt ? "RECEIVED" : "DELIVERED",
        days: (endAt.getTime() - startAt.getTime()) / 86_400_000,
        trackingNumbers,
        shipTimeStartedAt: shipTime.startedAt,
        shipTimeEndedAt: shipTime.endedAt,
        shipTimeMs: shipTime.ms,
        shipTimeLabel: shipTime.label
      });
    }
  }
  return samples;
}

function buildLeadTimeLogItem(group: LeadTimeSample[]): LeadTimeLogItem {
  const first = group[0];
  const sampleCount = group.length;
  const totalQuantityOrdered = group.reduce((sum, sample) => sum + sample.quantityOrdered, 0);
  const totalQuantityReceived = group.reduce((sum, sample) => sum + sample.quantityReceived, 0);
  const averageLeadTimeDays = roundDays(group.reduce((sum, sample) => sum + sample.days, 0) / sampleCount);
  const weightedAverageLeadTimeDays = totalQuantityOrdered > 0
    ? roundDays(group.reduce((sum, sample) => sum + sample.days * sample.quantityOrdered, 0) / totalQuantityOrdered)
    : averageLeadTimeDays;
  const bottleneckLeadTimeDays = roundDays(Math.max(...group.map((sample) => sample.days)));
  const shippingSamples = group.filter((sample) => sample.shipTimeMs !== null);
  const averageShipTimeDays = shippingSamples.length > 0
    ? roundDays(shippingSamples.reduce((sum, sample) => sum + (sample.shipTimeMs ?? 0) / 86_400_000, 0) / shippingSamples.length)
    : null;

  return {
    itemId: first.itemId,
    itemSku: first.itemSku,
    itemDescription: first.itemDescription,
    currentLeadTimeDays: first.itemManualLeadTimeDays ?? bottleneckLeadTimeDays,
    manualLeadTimeDays: first.itemManualLeadTimeDays,
    averageLeadTimeDays,
    weightedAverageLeadTimeDays,
    averageShipTimeDays,
    averageShipTimeLabel: averageShipTimeDays === null ? null : formatLeadTimeDays(averageShipTimeDays),
    leadTimeSource: first.itemManualLeadTimeDays !== null ? "MANUAL" : "OBSERVED",
    leadTimeLabel: first.itemManualLeadTimeDays !== null
      ? `${formatLeadTimeDays(first.itemManualLeadTimeDays)} manual planning estimate · completed samples retained as evidence`
      : `${formatLeadTimeDays(bottleneckLeadTimeDays)} observed bottleneck · ${sampleCount} completed sample${sampleCount === 1 ? "" : "s"}`,
    sampleCount,
    totalQuantityOrdered,
    totalQuantityReceived,
    entries: group
      .map((sample) => ({
        purchaseOrderId: sample.purchaseOrderId,
        externalOrderId: sample.externalOrderId,
        supplierId: sample.supplierId,
        supplierName: sample.supplierName,
        itemId: sample.itemId,
        itemSku: sample.itemSku,
        itemDescription: sample.itemDescription,
        quantityOrdered: sample.quantityOrdered,
        quantityReceived: sample.quantityReceived,
        startAt: sample.startAt,
        endAt: sample.endAt,
        endSource: sample.endSource,
        leadTimeDays: roundDays(sample.days),
        leadTimeLabel: `${formatLeadTimeDays(sample.days)} payment/order → ${sample.endSource === "RECEIVED" ? "receipt" : "delivery"}`,
        trackingNumbers: sample.trackingNumbers,
        shipTimeStartedAt: sample.shipTimeStartedAt,
        shipTimeEndedAt: sample.shipTimeEndedAt,
        shipTimeMs: sample.shipTimeMs,
        shipTimeLabel: sample.shipTimeLabel
      }))
      .sort((a, b) => b.endAt.getTime() - a.endAt.getTime())
  };
}

function buildManualLeadTimeLogItem(item: { id: string; sku: string; description: string; leadTimeDays: number; manualLeadTimeDays: number | null }): LeadTimeLogItem {
  const currentLeadTimeDays = item.manualLeadTimeDays ?? item.leadTimeDays;
  const hasManualLeadTime = item.manualLeadTimeDays !== null;
  return {
    itemId: item.id,
    itemSku: item.sku,
    itemDescription: item.description,
    currentLeadTimeDays,
    manualLeadTimeDays: item.manualLeadTimeDays,
    averageLeadTimeDays: currentLeadTimeDays,
    weightedAverageLeadTimeDays: currentLeadTimeDays,
    averageShipTimeDays: null,
    averageShipTimeLabel: null,
    leadTimeSource: hasManualLeadTime ? "MANUAL" : "CATALOG",
    leadTimeLabel: hasManualLeadTime
      ? `${currentLeadTimeDays}d manual planning estimate · no completed sample yet`
      : `${currentLeadTimeDays}d catalog/default planning lead time · no completed sample yet`,
    sampleCount: 0,
    totalQuantityOrdered: 0,
    totalQuantityReceived: 0,
    entries: []
  };
}

function computeOrderShipTime(trackings: Array<{
  deliveredAt: Date | null;
  lastEventAt: Date | null;
  capturedAt: Date;
  currentStatus: string;
  events: Array<{ occurredAt: Date | null }>;
}>) {
  const deliveredAt = earliestDate(trackings
    .filter((tracking) => tracking.currentStatus === "DELIVERED" || tracking.deliveredAt)
    .map((tracking) => tracking.deliveredAt ?? tracking.lastEventAt));
  if (!deliveredAt) return { startedAt: null, endedAt: null, ms: null, label: null };

  const eventDates = trackings.flatMap((tracking) => tracking.events.map((event) => event.occurredAt));
  const earliestEvent = earliestDate(eventDates);
  const fallbackCapturedAt = earliestDate(trackings.map((tracking) => tracking.capturedAt).filter((value) => value <= deliveredAt));
  const startedAt = earliestEvent ?? fallbackCapturedAt;
  if (!startedAt || deliveredAt < startedAt) return { startedAt: null, endedAt: deliveredAt, ms: null, label: null };

  const ms = deliveredAt.getTime() - startedAt.getTime();
  return { startedAt, endedAt: deliveredAt, ms, label: formatShipTime(ms) };
}

function roundDays(value: number) {
  return Number(value.toFixed(1));
}

function formatLeadTimeDays(value: number) {
  const rounded = roundDays(value);
  return `${rounded}d`;
}

function summarizeLeadTimes(samples: LeadTimeSample[], key: "itemId" | "supplierId") {
  const byId: Record<string, LeadTimeSummary> = {};
  const grouped = new Map<string, LeadTimeSample[]>();
  for (const sample of samples) {
    const id = sample[key];
    grouped.set(id, [...(grouped.get(id) ?? []), sample]);
  }
  for (const [id, group] of grouped.entries()) {
    const averageDays = group.reduce((sum, sample) => sum + sample.days, 0) / group.length;
    const bottleneckDays = Math.max(...group.map((sample) => sample.days));
    const lastSampleAt = group.reduce((latest, sample) => sample.endAt > latest ? sample.endAt : latest, group[0].endAt);
    byId[id] = {
      averageDays: Number(averageDays.toFixed(1)),
      roundedDays: Math.max(0, Math.round(bottleneckDays)),
      sampleCount: group.length,
      lastSampleAt: lastSampleAt.toISOString(),
      label: `${Number(bottleneckDays.toFixed(1))}d bottleneck · avg ${Number(averageDays.toFixed(1))}d · ${group.length} sample${group.length === 1 ? "" : "s"}`
    };
  }
  return byId;
}

function computeTrackingLeadTime(row: {
  currentStatus: string;
  deliveredAt: Date | null;
  lastEventAt: Date | null;
  purchaseOrder: null | {
    orderedAt: Date | null;
    emailOrderImports: Array<{ orderDate: Date | null }>;
    lines: Array<{ stockMovements: Array<{ createdAt: Date; stockLot: { receivedAt: Date } | null }> }>;
  };
  emailOrderImport: null | { orderDate: Date | null };
}): TrackingLeadTimeResult {
  const startAt = earliestDate([
    row.emailOrderImport?.orderDate ?? null,
    ...(row.purchaseOrder?.emailOrderImports.map((entry) => entry.orderDate) ?? []),
    row.purchaseOrder?.orderedAt ?? null
  ]);
  if (!startAt) return { startAt: null, endAt: null, endSource: null, days: null, label: null };

  const receivedAt = earliestDate(row.purchaseOrder?.lines.flatMap((line) =>
    line.stockMovements.map((movement) => movement.stockLot?.receivedAt ?? movement.createdAt)
  ) ?? []);
  const deliveredAt = normalizeTrackingStatus(row.currentStatus) === "DELIVERED" ? row.deliveredAt ?? row.lastEventAt : null;
  const endAt = receivedAt ?? deliveredAt;
  if (!endAt || endAt < startAt) return { startAt, endAt: null, endSource: null, days: null, label: null };

  const days = (endAt.getTime() - startAt.getTime()) / 86_400_000;
  const rounded = Number(days.toFixed(1));
  const endSource = receivedAt ? "RECEIVED" : "DELIVERED";
  return {
    startAt,
    endAt,
    endSource,
    days: rounded,
    label: `${rounded}d payment/order → ${endSource === "RECEIVED" ? "receipt" : "delivery"}`
  };
}

function earliestDate(values: Array<Date | null | undefined>) {
  const dates = values.filter((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()));
  if (dates.length === 0) return null;
  return dates.reduce((earliest, value) => (value < earliest ? value : earliest), dates[0]);
}

function extractExternalOrderIdFromText(text: string) {
  const normalized = String(text ?? "");
  const patterns = [
    /(?:alibaba\s*)?order\s*(?:number|no\.?|id|#)?\s*[:#-]?\s*([A-Za-z0-9-]*30\d{10,24}[A-Za-z0-9-]*)/i,
    /[?&](?:orderId|orderIdStr|tradeOrderId)=([A-Za-z0-9-]*30\d{10,24}[A-Za-z0-9-]*)/i,
    /(?<![A-Za-z0-9-])([A-Za-z0-9-]*30\d{10,24}[A-Za-z0-9-]*)(?![A-Za-z0-9-])/
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) return normalizeExternalOrderId(match[1]);
  }
  return undefined;
}

function normalizeExternalOrderId(value?: string | null) {
  const normalized = blankToUndefined(value ?? undefined)?.replace(/[^0-9A-Za-z-]/g, "");
  return normalized || undefined;
}

function extractFirstUrl(text: string) {
  const match = String(text ?? "").match(/https?:\/\/\S+/i);
  return match?.[0]?.replace(/[),.;]+$/g, "");
}

async function resolveManualTrackingOrderLink(input: {
  externalOrderId?: string;
  purchaseOrderId?: string;
  supplierName?: string;
  rawText?: string;
  sourceUrl?: string;
}) {
  const selectedOrder = input.purchaseOrderId
    ? await prisma.purchaseOrder.findUnique({
        where: { id: input.purchaseOrderId },
        include: { supplier: true, emailOrderImports: { orderBy: { updatedAt: "desc" } } }
      })
    : null;
  const explicitExternalOrderId = input.externalOrderId ?? selectedOrder?.emailOrderImports.find((entry) => entry.externalOrderId)?.externalOrderId ?? undefined;
  const matched = await resolveTrackingOrderLink({ externalOrderId: explicitExternalOrderId });
  const selectedImport = selectedOrder?.emailOrderImports.find((entry) => entry.externalOrderId === explicitExternalOrderId)
    ?? selectedOrder?.emailOrderImports[0]
    ?? null;
  const inferred = selectedOrder || matched.purchaseOrderId
    ? null
    : await inferManualTrackingOrderLinkFromEvidence({ rawText: input.rawText, supplierName: input.supplierName, sourceUrl: input.sourceUrl });

  return {
    externalOrderId: explicitExternalOrderId ?? matched.externalOrderId ?? selectedImport?.externalOrderId ?? inferred?.externalOrderId ?? null,
    supplierName: input.supplierName ?? matched.supplierName ?? selectedOrder?.supplier.name ?? selectedImport?.supplierName ?? inferred?.supplierName ?? null,
    purchaseOrderId: selectedOrder?.id ?? matched.purchaseOrderId ?? selectedImport?.purchaseOrderId ?? inferred?.purchaseOrderId ?? null,
    emailOrderImportId: matched.emailOrderImportId ?? selectedImport?.id ?? inferred?.emailOrderImportId ?? null
  };
}

async function inferManualTrackingOrderLinkFromEvidence(input: { rawText?: string; supplierName?: string; sourceUrl?: string }) {
  const haystack = normalizeManualLinkText([input.rawText, input.supplierName, input.sourceUrl].filter(Boolean).join("\n"));
  if (haystack.length < 3) return null;

  const orders = await prisma.purchaseOrder.findMany({
    where: { status: { in: [PurchaseOrderStatus.ORDERED, PurchaseOrderStatus.PARTIALLY_RECEIVED, PurchaseOrderStatus.RECEIVED] } },
    include: {
      supplier: true,
      emailOrderImports: { orderBy: { updatedAt: "desc" } },
      lines: {
        include: {
          item: { select: { sku: true, description: true, manufacturerPartNo: true, supplierSku: true } }
        }
      }
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 120
  });

  const scored = orders.map((order) => {
    let score = 0;
    const reasons: string[] = [];
    const supplierScore = scoreManualTextMatch(haystack, [order.supplier.name]);
    if (supplierScore > 0) {
      score += Math.min(6, supplierScore + 2);
      reasons.push("supplier");
    }

    for (const entry of order.emailOrderImports) {
      if (entry.externalOrderId && containsManualTerm(haystack, normalizeManualLinkText(entry.externalOrderId))) {
        score += 100;
        reasons.push("external-order-id");
      }
      if (entry.sourceUrl && containsManualTerm(haystack, normalizeManualLinkText(entry.sourceUrl))) {
        score += 20;
        reasons.push("source-url");
      }
      if (entry.supplierName) {
        const importSupplierScore = scoreManualTextMatch(haystack, [entry.supplierName]);
        if (importSupplierScore > 0) score += Math.min(4, importSupplierScore + 1);
      }
    }

    const lineTerms = unique(order.lines.flatMap((line) => manualTrackingItemTerms(line.item)));
    const itemScore = scoreManualTextMatch(haystack, lineTerms);
    if (itemScore > 0) {
      score += Math.min(12, itemScore);
      reasons.push("line-item");
    }

    return { order, score, reasons };
  }).filter((candidate) => candidate.score >= 6);

  scored.sort((left, right) => right.score - left.score || right.order.updatedAt.getTime() - left.order.updatedAt.getTime());
  const best = scored[0];
  const next = scored[1];
  if (!best) return null;
  if (next && best.score < 100 && best.score - next.score < 2) return null;

  const selectedImport = best.order.emailOrderImports.find((entry) => entry.externalOrderId)
    ?? best.order.emailOrderImports[0]
    ?? null;
  return {
    externalOrderId: selectedImport?.externalOrderId ?? null,
    supplierName: best.order.supplier.name ?? selectedImport?.supplierName ?? null,
    purchaseOrderId: best.order.id,
    emailOrderImportId: selectedImport?.id ?? null
  };
}

function manualTrackingItemTerms(item: { sku: string; description: string; manufacturerPartNo: string | null; supplierSku: string | null }) {
  const terms = new Set<string>();
  for (const value of [item.sku, item.supplierSku, item.manufacturerPartNo]) {
    const normalized = normalizeManualLinkText(value ?? "");
    if (normalized.length >= 2) terms.add(normalized);
    for (const token of normalized.split(" ")) if (token.length >= 3 && !MANUAL_LINK_STOP_WORDS.has(token)) terms.add(token);
  }
  const description = normalizeManualLinkText(item.description);
  for (const token of description.split(" ")) {
    if (token.length >= 4 && !MANUAL_LINK_STOP_WORDS.has(token)) terms.add(token);
  }
  if (/\b(?:power|adapter|psu)\b/.test(description) || /\bpsu\b/.test(normalizeManualLinkText(item.sku))) {
    terms.add("power supply");
    terms.add("psu");
  }
  return [...terms];
}

const MANUAL_LINK_STOP_WORDS = new Set(["with", "from", "order", "tracking", "number", "package", "shipment", "ship", "shipped", "delivered", "item", "items", "unit", "units", "certified"]);

function scoreManualTextMatch(haystack: string, terms: string[]) {
  let score = 0;
  for (const rawTerm of terms) {
    const term = normalizeManualLinkText(rawTerm);
    if (term.length < 2 || MANUAL_LINK_STOP_WORDS.has(term)) continue;
    if (!containsManualTerm(haystack, term)) continue;
    if (/\d/.test(term) && term.length >= 6) score += 7;
    else if (term.includes(" ")) score += 4;
    else if (term.length >= 5) score += 2;
    else score += 1;
  }
  return score;
}

function containsManualTerm(haystack: string, term: string) {
  if (!term) return false;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, "i").test(haystack);
}

function normalizeManualLinkText(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/https?:\/\//g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPortalEvidenceDateFromText(text: string) {
  const normalized = String(text ?? "");
  const patterns = [
    /(?:order\s*date|ordered\s*on|placed\s*on|created\s*on|created\s*at|completed\s*on|complete\s*date|delivered\s*on|delivery\s*date|shipped\s*on|shipping\s*date|paid\s*on)\s*[:#-]?\s*([^\n\r]{6,60})/gi,
    /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s*\d{4})\b/gi,
    /\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2})\b/g
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of normalized.matchAll(pattern)) {
      const parsed = parseDate(cleanPortalDateText(match[1]));
      if (parsed) return parsed;
    }
  }
  return undefined;
}

function cleanPortalDateText(value: string) {
  return String(value ?? "")
    .replace(/\b(?:PST|PDT|UTC|GMT|CST|EST|EDT|AM|PM)\b.*$/i, "")
    .replace(/[.,;，。；]+$/g, "")
    .trim();
}

function subtractMonths(now: Date, months: number) {
  const result = new Date(now);
  result.setUTCMonth(result.getUTCMonth() - Math.max(0, Number(months) || 0));
  return result;
}

function looksLikeTrackingNumber(value: string, options: { allowGenericNumeric?: boolean } = { allowGenericNumeric: true }) {
  if (!value) return false;
  if (/^30\d{10,24}$/.test(value)) return false;
  if (/^20\d{8,24}$/.test(value)) return false;
  if (/^1\d{10}$/.test(value)) return false;
  if (/^\d{10}$/.test(value)) return false;
  if (value.length < 10 || value.length > 32) return false;
  if (/^\d+$/.test(value) && !options.allowGenericNumeric) return false;
  return /\d/.test(value);
}

async function resolveTrackingOrderLink(input: { externalOrderId?: string; emailOrderImportId?: string | null }) {
  const explicitImport = input.emailOrderImportId
    ? await prisma.emailOrderImport.findUnique({ where: { id: input.emailOrderImportId } })
    : null;
  const lookupExternalOrderId = input.externalOrderId ?? explicitImport?.externalOrderId ?? undefined;
  const linkedImport = lookupExternalOrderId
    ? await prisma.emailOrderImport.findFirst({
        where: { externalOrderId: lookupExternalOrderId, purchaseOrderId: { not: null } },
        orderBy: { updatedAt: "desc" }
      })
    : null;
  const matchedImport = linkedImport ?? explicitImport ?? (lookupExternalOrderId
    ? await prisma.emailOrderImport.findFirst({
        where: { externalOrderId: lookupExternalOrderId },
        orderBy: [{ purchaseOrderId: "desc" }, { updatedAt: "desc" }]
      })
    : null);

  return {
    externalOrderId: lookupExternalOrderId ?? matchedImport?.externalOrderId ?? null,
    supplierName: explicitImport?.supplierName ?? matchedImport?.supplierName ?? null,
    purchaseOrderId: matchedImport?.purchaseOrderId ?? null,
    emailOrderImportId: explicitImport?.id ?? matchedImport?.id ?? null,
    orderDate: explicitImport?.orderDate ?? matchedImport?.orderDate ?? null
  };
}

function displayTrackingSupplierName(value?: string | null) {
  const trimmed = blankToUndefined(value ?? undefined);
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\s+/g, " ").trim();
  if (/^(?:to ship|waiting for supplier to ship|ship|shipped|tracking|logistics|package|delivered)$/i.test(normalized)) return null;
  if (/agree\s*to\s*terms|agreeToTermsAndConditions/i.test(normalized)) return null;
  if (/^[A-Z0-9]{10,}[&?=]/i.test(normalized)) return null;
  if (/^\d{10,}[A-Z0-9&?=.-]*$/i.test(normalized)) return null;
  return normalized;
}

function buildTrackingStatusUrl(template: string, row: { trackingNumber: string; carrier: string | null }) {
  return template
    .replaceAll("{trackingNumber}", encodeURIComponent(row.trackingNumber))
    .replaceAll("{carrier}", encodeURIComponent(row.carrier ?? "auto"));
}

type TrackingProviderRow = {
  id: string;
  trackingNumber: string;
  carrier: string | null;
  externalOrderId: string | null;
  purchaseOrderId: string | null;
  emailOrderImportId: string | null;
};

async function fetchTrackingStatus(row: TrackingProviderRow, config: TrackingServiceConfig, fetcher: FetchLike) {
  if (config.provider === "SHIP24") return fetchShip24TrackingStatus(row, config, fetcher);
  return fetchCustomTrackingStatus(row, config, fetcher);
}

async function fetchCustomTrackingStatus(row: TrackingProviderRow, config: TrackingServiceConfig, fetcher: FetchLike) {
  if (!config.urlTemplate) throw new Error(trackingConfigurationMessage(config));
  const url = buildTrackingStatusUrl(config.urlTemplate, row);
  const headers: Record<string, string> = { accept: "application/json" };
  if (config.authToken) headers[config.authHeader ?? "authorization"] = config.authHeader?.toLowerCase() === "authorization" || !config.authHeader ? `Bearer ${config.authToken}` : config.authToken;
  const response = await fetcher(url, { method: "GET", headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Tracking service returned HTTP ${response.status}`);
  return { body, normalizedStatus: normalizeTrackingServiceResponse(body) };
}

async function fetchShip24TrackingStatus(row: TrackingProviderRow, config: TrackingServiceConfig, fetcher: FetchLike) {
  if (!config.authToken) throw new Error(trackingConfigurationMessage(config));
  const baseUrl = (config.ship24BaseUrl ?? DEFAULT_SHIP24_BASE_URL).replace(/\/$/, "");
  const requestBody = buildShip24TrackerRequestBody(row, config);
  const clientTrackerId = firstString([requestBody.clientTrackerId]);
  await dedupeShip24Trackers({
    baseUrl,
    authToken: config.authToken,
    fetcher,
    keepTrackingNumber: row.trackingNumber,
    keepClientTrackerId: clientTrackerId ?? undefined
  });
  const response = await fetcher(`${baseUrl}/public/v1/trackers/track`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${config.authToken}`
    },
    body: JSON.stringify(requestBody)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(formatShip24HttpError(response.status, body));
  return { body, normalizedStatus: normalizeShip24TrackingServiceResponse(body) };
}

function buildShip24TrackerRequestBody(row: TrackingProviderRow, config: TrackingServiceConfig) {
  const shipmentReference = row.externalOrderId ?? row.purchaseOrderId ?? row.emailOrderImportId ?? row.id;
  const destinationCountryCode = normalizeCountryCode(config.destinationCountryCode) ?? "CA";
  const originCountryCode = normalizeCountryCode(config.originCountryCode);
  const courierName = row.carrier ?? undefined;
  return pruneUndefined({
    trackingNumber: row.trackingNumber,
    clientTrackerId: buildShip24ClientTrackerId(row.id, {
      trackingNumber: row.trackingNumber,
      shipmentReference,
      destinationCountryCode,
      originCountryCode,
      courierName
    }),
    shipmentReference,
    destinationCountryCode,
    originCountryCode,
    courierName
  });
}

function buildShip24ClientTrackerId(rowId: string, input: Record<string, unknown>) {
  const signature = createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 10);
  return `${rowId}-${signature}`;
}

type Ship24TrackerListEntry = {
  trackerId: string;
  trackingNumber: string;
  clientTrackerId: string | null;
  createdAt: string | null;
  isTracked: boolean;
  isSubscribed: boolean;
};

async function dedupeShip24Trackers(input: {
  baseUrl: string;
  authToken: string;
  fetcher: FetchLike;
  keepTrackingNumber: string;
  keepClientTrackerId?: string;
}) {
  const response = await input.fetcher(`${input.baseUrl}/public/v1/trackers?limit=100`, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.authToken}`
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(formatShip24HttpError(response.status, body));

  const trackers = extractShip24TrackerList(body);
  const grouped = new Map<string, Ship24TrackerListEntry[]>();
  for (const tracker of trackers) {
    const normalized = normalizeTrackingNumber(tracker.trackingNumber);
    grouped.set(normalized, [...(grouped.get(normalized) ?? []), tracker]);
  }

  const keepTrackingNumber = normalizeTrackingNumber(input.keepTrackingNumber);
  for (const [trackingNumber, entries] of grouped.entries()) {
    const activeEntries = entries.filter((entry) => entry.isTracked || entry.isSubscribed);
    if (activeEntries.length === 0) continue;
    const keepEntry = trackingNumber === keepTrackingNumber && input.keepClientTrackerId
      ? activeEntries.find((entry) => entry.clientTrackerId === input.keepClientTrackerId)
      : newestShip24Tracker(activeEntries);
    const staleEntries = trackingNumber === keepTrackingNumber && !keepEntry
      ? activeEntries
      : activeEntries.filter((entry) => entry.trackerId !== keepEntry?.trackerId);

    for (const staleEntry of staleEntries) {
      await deactivateShip24Tracker(input.baseUrl, input.authToken, staleEntry, input.fetcher);
    }
  }
}

function extractShip24TrackerList(body: unknown): Ship24TrackerListEntry[] {
  const trackers = firstArray(findByKeys(body, ["trackers"])) ?? [];
  return trackers.map((entry): Ship24TrackerListEntry | null => {
    if (!isRecord(entry)) return null;
    const trackerId = firstString([entry.trackerId]);
    const trackingNumber = firstString([entry.trackingNumber]);
    if (!trackerId || !trackingNumber) return null;
    return {
      trackerId,
      trackingNumber,
      clientTrackerId: firstString([entry.clientTrackerId]) ?? null,
      createdAt: firstString([entry.createdAt]) ?? null,
      isTracked: entry.isTracked === true,
      isSubscribed: entry.isSubscribed === true
    };
  }).filter((entry): entry is Ship24TrackerListEntry => Boolean(entry));
}

function newestShip24Tracker(entries: Ship24TrackerListEntry[]) {
  return [...entries].sort((left, right) => ship24TrackerTime(right) - ship24TrackerTime(left))[0];
}

function ship24TrackerTime(entry: Ship24TrackerListEntry) {
  return entry.createdAt ? Date.parse(entry.createdAt) || 0 : 0;
}

async function deactivateShip24Tracker(baseUrl: string, authToken: string, tracker: Ship24TrackerListEntry, fetcher: FetchLike) {
  const response = await fetcher(`${baseUrl}/public/v1/trackers/${encodeURIComponent(tracker.trackerId)}`, {
    method: "PATCH",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({ isSubscribed: false, isTracked: false })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(formatShip24HttpError(response.status, body));
}

function formatShip24HttpError(status: number, body: unknown) {
  const providerMessage = extractProviderErrorMessage(body);
  return providerMessage ? `Ship24 tracking service returned HTTP ${status}: ${providerMessage}` : `Ship24 tracking service returned HTTP ${status}`;
}

function extractProviderErrorMessage(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const errors = Array.isArray(body.errors) ? body.errors : [];
  const messages = errors
    .map((error) => isRecord(error) ? firstString([error.message]) ?? firstString([error.code]) : firstString([error]))
    .filter((message): message is string => Boolean(message));
  return messages[0] ?? firstString([body.message]) ?? firstString([body.error]) ?? null;
}

function isTrackingServiceConfigured(config: TrackingServiceConfig) {
  if (normalizeProviderName(config.provider) === "SHIP24") return Boolean(config.authToken);
  return Boolean(config.urlTemplate);
}

function trackingConfigurationMessage(config: TrackingServiceConfig) {
  if (normalizeProviderName(config.provider) === "SHIP24") {
    return "Set LAMBENTI_TRACKING_STATUS_PROVIDER=SHIP24 and LAMBENTI_TRACKING_STATUS_AUTH_TOKEN to enable Ship24 tracking refresh.";
  }
  return "Set LAMBENTI_TRACKING_STATUS_URL_TEMPLATE to enable tracking-service refresh.";
}

function normalizeShip24TrackingServiceResponse(body: unknown): NormalizedTrackingStatus {
  const trackings = firstArray(findByKeys(body, ["trackings"])) ?? [];
  const tracking = firstObject(trackings) ?? firstObject(findByKeys(body, ["tracking"])) ?? body;
  const shipment = firstObject(findByKeys(tracking, ["shipment"])) ?? {};
  const eventsRaw = firstArray(findByKeys(tracking, ["events"])) ?? [];
  const events = eventsRaw.map((event) => normalizeShip24TrackingEvent(event)).filter((event): event is NormalizedTrackingEvent => Boolean(event));
  const shipmentMilestone = firstString(findByKeys(shipment, ["statusMilestone", "statusCode", "statusCategory"]));
  const statusDescription = events[0]?.description
    ?? firstString(findByKeys(shipment, ["status", "statusMilestone", "statusCode", "statusCategory"]));
  const lastEventAt = events[0]?.occurredAt
    ?? firstDate(findByKeys(shipment, ["deliveredDatetime", "outForDeliveryDatetime", "inTransitDatetime", "infoReceivedDatetime"]))
    ?? null;
  const deliveredAt = firstDate(findByKeys(shipment, ["deliveredDatetime"]))
    ?? (normalizeTrackingStatus(shipmentMilestone ?? "") === "DELIVERED" ? lastEventAt : null);
  return {
    carrier: firstString(findByKeys(tracking, ["courierCode", "courierName", "sourceCode"])),
    currentStatus: normalizeTrackingStatusFromEvidence(shipmentMilestone ?? "", statusDescription, events),
    statusDescription,
    origin: firstString(findByKeys(shipment, ["originCountryCode"])),
    destination: firstString(findByKeys(shipment, ["destinationCountryCode"])),
    lastEventAt,
    deliveredAt,
    events
  };
}

function normalizeShip24TrackingEvent(value: unknown): NormalizedTrackingEvent | null {
  if (!isRecord(value)) return null;
  const description = firstString(findByKeys(value, ["status", "description", "message"]));
  if (!description) return null;
  return {
    status: firstString(findByKeys(value, ["statusMilestone", "statusCode", "statusCategory"])),
    description,
    location: firstString(findByKeys(value, ["location"])),
    occurredAt: firstDate(findByKeys(value, ["occurrenceDatetime", "datetime", "time", "date"])),
    raw: value
  };
}

type NormalizedTrackingStatus = {
  carrier?: string;
  currentStatus?: string;
  statusDescription?: string;
  origin?: string;
  destination?: string;
  lastEventAt?: Date | null;
  deliveredAt?: Date | null;
  events: Array<{ status?: string; description: string; location?: string | null; occurredAt?: Date | null; raw: unknown }>;
};

type NormalizedTrackingEvent = NormalizedTrackingStatus["events"][number];

function normalizeTrackingServiceResponse(body: unknown): NormalizedTrackingStatus {
  const latestEvent = firstObject(findByKeys(body, ["latestEvent", "latest_event", "checkpoint", "last_checkpoint"]));
  const eventsRaw = firstArray(findByKeys(body, ["events", "checkpoints", "tracking_events", "trackingEvents", "history"])) ?? [];
  const events = eventsRaw.map((event) => normalizeTrackingEvent(event)).filter((event): event is NormalizedTrackingEvent => Boolean(event));
  const statusDescription = firstString(findByKeys(body, ["statusDescription", "status_description", "subtag_message", "message", "description", "checkpoint_message"]))
    ?? latestEventDescription(latestEvent)
    ?? events[0]?.description;
  const lastEventAt = firstDate(findByKeys(body, ["lastEventAt", "last_event_at", "checkpoint_time", "event_time", "updated_at"]))
    ?? latestEventDate(latestEvent)
    ?? events[0]?.occurredAt
    ?? null;
  return {
    carrier: firstString(findByKeys(body, ["carrier", "courier", "slug", "shipping_provider", "serviceProvider", "service_provider"])),
    currentStatus: normalizeTrackingStatusFromEvidence(
      firstString(findByKeys(body, ["currentStatus", "current_status", "delivery_status", "tag", "status"])) ?? "",
      statusDescription,
      events
    ),
    statusDescription,
    origin: firstString(findByKeys(body, ["origin", "shipFrom", "ship_from"])),
    destination: firstString(findByKeys(body, ["destination", "shipTo", "ship_to"])),
    lastEventAt,
    deliveredAt: firstDate(findByKeys(body, ["deliveredAt", "delivered_at", "delivery_time"])),
    events
  };
}

function normalizeTrackingEvent(value: unknown): NormalizedTrackingEvent | null {
  if (!isRecord(value)) return null;
  const description = firstString(findByKeys(value, ["description", "message", "checkpoint_message", "statusDescription", "status_description"]))
    ?? firstString(findByKeys(value, ["status", "tag"]));
  if (!description) return null;
  return {
    status: firstString(findByKeys(value, ["status", "tag", "delivery_status"])),
    description,
    location: firstString(findByKeys(value, ["location", "city", "checkpoint_location"])),
    occurredAt: firstDate(findByKeys(value, ["occurredAt", "occurred_at", "checkpoint_time", "event_time", "time", "date"])),
    raw: value
  };
}

async function persistTrackingEvents(trackingNumberId: string, events: NormalizedTrackingStatus["events"]) {
  for (const event of events) {
    const existing = await prisma.trackingEvent.findFirst({
      where: {
        trackingNumberId,
        description: event.description,
        occurredAt: event.occurredAt ?? null
      }
    });
    if (existing) continue;
    await prisma.trackingEvent.create({
      data: {
        trackingNumberId,
        status: normalizeTrackingEventStatus(event),
        description: event.description,
        location: event.location,
        occurredAt: event.occurredAt ?? null,
        rawEventJson: toJson(event.raw)
      }
    });
  }
}

function normalizeTrackingStatus(value: string) {
  const normalized = value.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toUpperCase();
  if (!normalized) return "UNKNOWN";
  if (normalized.includes("DELIVERED") || ["SIGNED", "SUCCESSFULLY_DELIVERED"].includes(normalized)) return "DELIVERED";
  if (normalized.includes("EXCEPTION") || ["FAILED", "RETURNED", "EXPIRED"].includes(normalized)) return normalized.includes("EXCEPTION") ? "EXCEPTION" : normalized;
  if (normalized.includes("TRANSIT") || normalized.includes("OUT_FOR_DELIVERY") || ["SHIPPED", "SHIPMENT_STARTED", "DISPATCHED"].includes(normalized)) return "IN_TRANSIT";
  if (["INFO_RECEIVED", "INFORMATION_RECEIVED"].includes(normalized) || normalized.includes("INFORMATION_RECEIVED") || normalized.includes("RECEIVED_INFORMATION")) return "INFO_RECEIVED";
  if (["PENDING", "PRE_TRANSIT", "WAITING_FOR_PICKUP"].includes(normalized) || normalized.startsWith("DATA")) return "PENDING";
  return normalized;
}

function normalizeTrackingStatusFromEvidence(
  value: string,
  statusDescription?: string | null,
  events: Array<{ status?: string | null; description: string }> = []
) {
  const normalized = normalizeTrackingStatus(value);
  if (normalized === "PENDING" && hasInfoReceivedTrackingEntry(statusDescription, events)) return "INFO_RECEIVED";
  return normalized;
}

function normalizeTrackingEventStatus(event: NormalizedTrackingEvent) {
  const status = event.status ? normalizeTrackingStatus(event.status) : "UNKNOWN";
  if ((status === "PENDING" || status === "UNKNOWN") && hasInfoReceivedTrackingEntry(event.description, [event])) return "INFO_RECEIVED";
  return status === "UNKNOWN" ? null : status;
}

function hasInfoReceivedTrackingEntry(
  statusDescription?: string | null,
  events: Array<{ status?: string | null; description: string }> = []
) {
  return [statusDescription, ...events.flatMap((event) => [event.status, event.description])]
    .filter((value): value is string => Boolean(value))
    .some((value) => {
      const normalized = value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
      return /\binfo(?:rmation)? received\b/.test(normalized)
        || /\breceived (?:the )?(?:shipment |carrier |tracking |electronic |data )?info(?:rmation)?\b/.test(normalized)
        || /\bcarrier (?:has )?received (?:the )?(?:shipment |tracking |electronic |data )?info(?:rmation)?\b/.test(normalized)
        || /\b(?:shipper|sender) created (?:a )?label\b/.test(normalized)
        || /\blabel (?:has been )?created\b/.test(normalized)
        || /\bshipment information sent\b/.test(normalized)
        || /\bdata information received\b/.test(normalized)
        || /\belectronic (?:information|data) (?:submitted|received)\b/.test(normalized)
        || /\bshipment (?:information|data) (?:submitted|received)\b/.test(normalized);
    });
}

function inferCarrier(value: string) {
  if (/\b1Z[0-9A-Z]{16}\b/i.test(value)) return "UPS";
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/i.test(value)) return value.endsWith("CN") ? "China Post/EMS" : null;
  const prefix = value.match(/^([A-Z]{2,5})\s+/)?.[1];
  return prefix ?? null;
}

function buildLinkedOrderLabel(row: { externalOrderId: string | null; purchaseOrderId: string | null; emailOrderImportId: string | null }) {
  const parts = [];
  if (row.externalOrderId) parts.push(`Alibaba ${row.externalOrderId}`);
  if (row.purchaseOrderId) parts.push(`PO ${row.purchaseOrderId.slice(-8)}`);
  if (row.emailOrderImportId && !row.purchaseOrderId) parts.push(`Evidence import ${row.emailOrderImportId.slice(-8)}`);
  return parts.length > 0 ? parts.join(" · ") : "Unlinked evidence";
}

function findByKeys(value: unknown, keys: string[]): unknown[] {
  const found: unknown[] = [];
  const lowerKeys = new Set(keys.map((key) => key.toLowerCase()));
  const seen = new Set<unknown>();
  function visit(node: unknown) {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (lowerKeys.has(key.toLowerCase())) found.push(child);
      if (typeof child === "object") visit(child);
    }
  }
  visit(value);
  return found;
}

function firstString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
    if (Array.isArray(value)) {
      const nested: string | undefined = firstString(value);
      if (nested) return nested;
    }
  }
  return undefined;
}

function firstDate(values: unknown[]) {
  for (const value of values) {
    const parsed = parseDate(value);
    if (parsed) return parsed;
  }
  return undefined;
}

function firstArray(values: unknown[]) {
  return values.find((value): value is unknown[] => Array.isArray(value));
}

function firstObject(values: unknown[]) {
  return values.find(isRecord);
}

function latestEventDescription(value: unknown) {
  if (!isRecord(value)) return undefined;
  return firstString(findByKeys(value, ["description", "message", "checkpoint_message"]));
}

function latestEventDate(value: unknown) {
  if (!isRecord(value)) return undefined;
  return firstDate(findByKeys(value, ["occurredAt", "occurred_at", "checkpoint_time", "event_time", "time", "date"]));
}

function parseDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60_000);
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function blankToUndefined(value?: string) {
  return value?.trim() ? value.trim() : undefined;
}

function normalizeProviderName(value?: string) {
  return blankToUndefined(value)?.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "UNCONFIGURED";
}

function normalizeCountryCode(value?: string) {
  const normalized = blankToUndefined(value)?.toUpperCase();
  return normalized && /^[A-Z]{2,3}$/.test(normalized) ? normalized : undefined;
}

function pruneUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ""));
}

function positiveInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
