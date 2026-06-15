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
  const externalOrderId = normalizeExternalOrderId(input.externalOrderId) ?? extractExternalOrderIdFromText(input.rawText);
  const excluded = new Set([externalOrderId].filter((value): value is string => Boolean(value)).map(normalizeTrackingNumber));
  const trackingNumbers = extractManualTrackingNumbersFromText(input.rawText)
    .filter((value) => !excluded.has(value));
  if (trackingNumbers.length === 0) return { saved: 0, updated: 0, skipped: 1, records: [] };

  const link = await resolveManualTrackingOrderLink({
    externalOrderId,
    purchaseOrderId: blankToUndefined(input.purchaseOrderId ?? undefined),
    supplierName: blankToUndefined(input.supplierName ?? undefined),
    rawText: input.rawText
  });
  const sourceUrl = blankToUndefined(input.sourceUrl ?? undefined) ?? extractFirstUrl(input.rawText);
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

  if (!isTrackingServiceConfigured(config)) {
    const updated = await prisma.trackingNumber.update({
      where: { id: existing.id },
      data: {
        provider: config.provider ?? "UNCONFIGURED",
        refreshStatus: "CONFIG_REQUIRED",
        refreshError: trackingConfigurationMessage(config),
        lastCheckedAt: now
      }
    });
    return updated;
  }

  try {
    const response = await fetchTrackingStatus(existing, config, input.fetcher ?? fetch);
    const body = response.body;
    const normalizedStatus = response.normalizedStatus;
    const status = normalizeTrackingStatus(normalizedStatus.currentStatus ?? existing.currentStatus);
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

export async function refreshDueTrackingNumbers(input: {
  actorId: string;
  now?: Date;
  limit?: number;
  config?: TrackingServiceConfig;
  fetcher?: FetchLike;
}) {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 25;
  const totalCandidates = await prisma.trackingNumber.count({
    where: { currentStatus: { not: "DELIVERED" } }
  });
  const due = await prisma.trackingNumber.findMany({
    where: {
      currentStatus: { not: "DELIVERED" },
      OR: [{ nextRefreshAt: null }, { nextRefreshAt: { lte: now } }]
    },
    orderBy: [{ nextRefreshAt: "asc" }, { updatedAt: "asc" }],
    take: limit
  });

  let refreshed = 0;
  let failed = 0;
  for (const row of due) {
    const result = await refreshTrackingNumber({
      trackingNumber: row.trackingNumber,
      actorId: input.actorId,
      now,
      config: input.config,
      fetcher: input.fetcher
    });
    if (result.refreshStatus === "SUCCESS") refreshed += 1;
    else failed += 1;
  }
  return { scanned: due.length, refreshed, failed, skipped: Math.max(0, totalCandidates - due.length) };
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
      currentStatus: row.currentStatus,
      statusDescription: row.statusDescription,
      refreshStatus: row.refreshStatus,
      refreshError: row.refreshError,
      externalOrderId: row.externalOrderId,
      purchaseOrderId: row.purchaseOrderId,
      emailOrderImportId: row.emailOrderImportId,
      linkedOrderLabel: buildLinkedOrderLabel(row),
      supplierName: row.supplierName ?? row.purchaseOrder?.supplier.name ?? row.emailOrderImport?.supplierName ?? null,
      source: row.source,
      sourceUrl: row.sourceUrl,
      lastEventAt: row.lastEventAt,
      deliveredAt: row.deliveredAt,
      lastCheckedAt: row.lastCheckedAt,
      nextRefreshAt: row.currentStatus === "DELIVERED" ? null : row.nextRefreshAt,
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
        : null
    };
  });
  const activeRows = mappedRows.filter((row) => row.currentStatus !== "DELIVERED");
  const deliveredRows = mappedRows.filter((row) => row.currentStatus === "DELIVERED");

  return {
    service: {
      configured: isTrackingServiceConfigured(config),
      provider: config.provider ?? (config.urlTemplate ? "CUSTOM_HTTP" : "UNCONFIGURED"),
      refreshIntervalMinutes: config.refreshIntervalMinutes ?? DEFAULT_REFRESH_INTERVAL_MINUTES
    },
    summary: {
      total: rows.length,
      due: rows.filter((row) => row.currentStatus !== "DELIVERED" && (!row.nextRefreshAt || row.nextRefreshAt <= now)).length,
      delivered: rows.filter((row) => row.currentStatus === "DELIVERED").length,
      needsConfiguration: rows.filter((row) => row.refreshStatus === "CONFIG_REQUIRED").length,
      failed: rows.filter((row) => row.refreshStatus === "FAILED").length
    },
    rows: activeRows,
    deliveredRows
  };
}

export async function getLeadTimeSummaryIndex(): Promise<LeadTimeSummaryIndex> {
  const samples = await buildLeadTimeSamples();
  return {
    byItemId: summarizeLeadTimes(samples, "itemId"),
    bySupplierId: summarizeLeadTimes(samples, "supplierId")
  };
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
    const item = await prisma.item.findUnique({ where: { id: itemId }, select: { id: true, leadTimeDays: true } });
    if (!item || item.leadTimeDays === summary.roundedDays) continue;
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
  itemId: string;
  startAt: Date;
  endAt: Date;
  endSource: "RECEIVED" | "DELIVERED";
  days: number;
};

async function buildLeadTimeSamples(): Promise<LeadTimeSample[]> {
  const orders = await prisma.purchaseOrder.findMany({
    include: {
      emailOrderImports: { select: { orderDate: true } },
      trackingNumbers: { select: { deliveredAt: true, currentStatus: true } },
      lines: {
        include: {
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
      .map((tracking) => tracking.deliveredAt));
    for (const line of order.lines) {
      const receivedAt = earliestDate(line.stockMovements.map((movement) => movement.stockLot?.receivedAt ?? movement.createdAt));
      const endAt = receivedAt ?? deliveredAt;
      if (!endAt || endAt < startAt) continue;
      samples.push({
        purchaseOrderId: order.id,
        supplierId: order.supplierId,
        itemId: line.itemId,
        startAt,
        endAt,
        endSource: receivedAt ? "RECEIVED" : "DELIVERED",
        days: (endAt.getTime() - startAt.getTime()) / 86_400_000
      });
    }
  }
  return samples;
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
    const lastSampleAt = group.reduce((latest, sample) => sample.endAt > latest ? sample.endAt : latest, group[0].endAt);
    byId[id] = {
      averageDays: Number(averageDays.toFixed(1)),
      roundedDays: Math.max(0, Math.round(averageDays)),
      sampleCount: group.length,
      lastSampleAt: lastSampleAt.toISOString(),
      label: `${Number(averageDays.toFixed(1))}d avg · ${group.length} sample${group.length === 1 ? "" : "s"}`
    };
  }
  return byId;
}

function computeTrackingLeadTime(row: {
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
  const deliveredAt = row.deliveredAt ?? row.lastEventAt;
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
    /(?:alibaba\s*)?order\s*(?:number|no\.?|id|#)?\s*[:#-]?\s*(30\d{10,24})/i,
    /[?&](?:orderId|orderIdStr|tradeOrderId)=(30\d{10,24})/i,
    /\b(30\d{10,24})\b/
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

  return {
    externalOrderId: explicitExternalOrderId ?? matched.externalOrderId ?? selectedImport?.externalOrderId ?? null,
    supplierName: input.supplierName ?? matched.supplierName ?? selectedOrder?.supplier.name ?? selectedImport?.supplierName ?? null,
    purchaseOrderId: selectedOrder?.id ?? matched.purchaseOrderId ?? selectedImport?.purchaseOrderId ?? null,
    emailOrderImportId: matched.emailOrderImportId ?? selectedImport?.id ?? null
  };
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
  const matchedImport = explicitImport ?? (input.externalOrderId
    ? await prisma.emailOrderImport.findFirst({
        where: { externalOrderId: input.externalOrderId },
        orderBy: [{ purchaseOrderId: "desc" }, { updatedAt: "desc" }]
      })
    : null);

  return {
    externalOrderId: input.externalOrderId ?? matchedImport?.externalOrderId ?? null,
    supplierName: matchedImport?.supplierName ?? null,
    purchaseOrderId: matchedImport?.purchaseOrderId ?? null,
    emailOrderImportId: matchedImport?.id ?? null,
    orderDate: matchedImport?.orderDate ?? null
  };
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
  const response = await fetcher(`${baseUrl}/public/v1/trackers/track`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${config.authToken}`
    },
    body: JSON.stringify(pruneUndefined({
      trackingNumber: row.trackingNumber,
      clientTrackerId: row.id,
      shipmentReference: row.externalOrderId ?? row.purchaseOrderId ?? row.emailOrderImportId ?? row.id,
      destinationCountryCode: normalizeCountryCode(config.destinationCountryCode) ?? "CA",
      originCountryCode: normalizeCountryCode(config.originCountryCode),
      courierName: row.carrier ?? undefined
    }))
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Ship24 tracking service returned HTTP ${response.status}`);
  return { body, normalizedStatus: normalizeShip24TrackingServiceResponse(body) };
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
    currentStatus: shipmentMilestone,
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
    currentStatus: firstString(findByKeys(body, ["currentStatus", "current_status", "delivery_status", "tag", "status"])),
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
        status: event.status ? normalizeTrackingStatus(event.status) : null,
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
  if (["PENDING", "INFO_RECEIVED", "PRE_TRANSIT", "WAITING_FOR_PICKUP"].includes(normalized)) return "PENDING";
  return normalized;
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
  if (row.emailOrderImportId && !row.purchaseOrderId) parts.push(`Import ${row.emailOrderImportId.slice(-8)}`);
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
