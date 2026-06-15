import { createHash } from "crypto";
import {
  AutomationFindingSeverity,
  AutomationRunKind,
  AutomationRunStatus,
  ItemCategory,
  LifecycleStatus,
  Prisma,
  PurchaseOrderStatus,
  PurchaseRequestStatus
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { getStockSummaries } from "@/modules/inventory/service";
import { createDraftPurchaseRequest } from "@/modules/purchasing/service";

export type AutomationActor = {
  actorType: "USER" | "AGENT" | "SYSTEM";
  actorId: string;
};

type FindingInput = {
  severity: AutomationFindingSeverity;
  category: string;
  entityType: string;
  entityId: string;
  title: string;
  message: string;
  suggestedActionType?: string;
  suggestedActionJson?: Prisma.InputJsonValue;
  dedupeKey: string;
};

type AutomationRunResult = {
  run: Awaited<ReturnType<typeof prisma.automationRun.findUniqueOrThrow>>;
  findings: Awaited<ReturnType<typeof prisma.automationFinding.findMany>>;
};

export async function runStockReorderScan(actor: AutomationActor): Promise<AutomationRunResult> {
  const run = await createRun(AutomationRunKind.STOCK_REORDER_SCAN, actor, { scope: "active-items" });

  try {
    const stock = await getStockSummaries();
    const itemIds = stock.map((item) => item.itemId);
    const [items, incomingByItem, openPrByItem] = await Promise.all([
      prisma.item.findMany({ where: { id: { in: itemIds } }, include: { preferredSupplier: true } }),
      getIncomingSupplyByItem(itemIds),
      getOpenPurchaseRequestQuantityByItem(itemIds)
    ]);
    const itemById = new Map(items.map((item) => [item.id, item]));

    const findingInputs: FindingInput[] = [];
    for (const row of stock) {
      const item = itemById.get(row.itemId);
      if (!item || item.lifecycleStatus === LifecycleStatus.OBSOLETE || item.category === ItemCategory.FINISHED_GOOD) continue;

      const incoming = incomingByItem.get(row.itemId) ?? 0;
      const openPr = openPrByItem.get(row.itemId) ?? 0;
      const projected = row.available + incoming + openPr;
      const suggestedQuantity = Math.max(row.targetStock - projected, 0);
      if (row.available >= row.reorderPoint || suggestedQuantity <= 0) continue;

      findingInputs.push({
        severity: row.available <= 0 ? AutomationFindingSeverity.HIGH : AutomationFindingSeverity.MEDIUM,
        category: "REORDER_SHORTAGE",
        entityType: "Item",
        entityId: row.itemId,
        title: `${row.sku} is below reorder point`,
        message: `Available ${row.available}; reorder point ${row.reorderPoint}; incoming ${incoming}; open purchase requests ${openPr}; target ${row.targetStock}. Suggested order quantity ${suggestedQuantity}.`,
        suggestedActionType: "DRAFT_PURCHASE_REQUEST",
        suggestedActionJson: {
          itemId: row.itemId,
          sku: row.sku,
          suggestedQuantity,
          preferredSupplierId: item.preferredSupplier?.archivedAt ? null : item.preferredSupplierId,
          rationale: `Automation reorder scan: available ${row.available}, incoming ${incoming}, open PR ${openPr}, target ${row.targetStock}. Human approval required before purchase.`
        },
        dedupeKey: [
          "STOCK_REORDER_SCAN",
          "Item",
          row.itemId,
          `available=${row.available}`,
          `incoming=${incoming}`,
          `openPr=${openPr}`,
          `target=${row.targetStock}`,
          `suggest=${suggestedQuantity}`
        ].join(":")
      });
    }

    const findings = await recordFindings(run.id, findingInputs, { staleDedupePrefix: "STOCK_REORDER_SCAN:" });
    const finalRun = await finishRun(run.id, AutomationRunStatus.SUCCEEDED, {
      scannedItems: stock.length,
      findingsOpenedOrRefreshed: findings.length
    });
    return { run: finalRun, findings };
  } catch (error) {
    const failed = await failRun(run.id, error);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { automationRun: failed });
  }
}

export async function runInventoryAnomalyScan(actor: AutomationActor): Promise<AutomationRunResult> {
  const run = await createRun(AutomationRunKind.INVENTORY_ANOMALY_SCAN, actor, { scope: "inventory-risk" });

  try {
    const items = await prisma.item.findMany({
      where: { lifecycleStatus: { not: LifecycleStatus.OBSOLETE } },
      include: { stockMovements: true, preferredSupplier: true }
    });

    const findingInputs: FindingInput[] = [];
    for (const item of items) {
      if (item.lifecycleStatus === LifecycleStatus.ACTIVE && !item.preferredSupplierId) {
        findingInputs.push({
          severity: AutomationFindingSeverity.LOW,
          category: "ITEM_WITHOUT_PREFERRED_SUPPLIER",
          entityType: "Item",
          entityId: item.id,
          title: `${item.sku} has no preferred supplier`,
          message: "Active item has no preferred supplier, which weakens automated purchasing recommendations.",
          suggestedActionType: "SET_PREFERRED_SUPPLIER",
          suggestedActionJson: { itemId: item.id, sku: item.sku },
          dedupeKey: `INVENTORY_ANOMALY_SCAN:ITEM_WITHOUT_PREFERRED_SUPPLIER:Item:${item.id}:updated=${item.updatedAt.getTime()}`
        });
      }
    }

    const findings = await recordFindings(run.id, findingInputs, { staleDedupePrefix: "INVENTORY_ANOMALY_SCAN:" });
    const finalRun = await finishRun(run.id, AutomationRunStatus.SUCCEEDED, {
      scannedItems: items.length,
      findingsOpenedOrRefreshed: findings.length
    });
    return { run: finalRun, findings };
  } catch (error) {
    const failed = await failRun(run.id, error);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { automationRun: failed });
  }
}

export async function createDraftPurchaseRequestFromFinding(input: { findingId: string } & AutomationActor) {
  if (input.actorType === "SYSTEM") {
    throw new Error("A human or authenticated agent actor is required to draft a purchase request from an automation finding.");
  }

  const finding = await prisma.automationFinding.findUnique({ where: { id: input.findingId } });
  if (!finding) throw new Error("Automation finding does not exist.");
  if (finding.status !== "OPEN") throw new Error("Only open automation findings can create draft purchase requests.");
  if (finding.suggestedActionType !== "DRAFT_PURCHASE_REQUEST") {
    throw new Error("This automation finding does not contain a draft purchase request suggestion.");
  }

  const payload = parseDraftPurchaseRequestPayload(finding.suggestedActionJson);
  const purchaseRequest = await createDraftPurchaseRequest({
    itemId: payload.itemId,
    quantity: payload.suggestedQuantity,
    rationale: payload.rationale ?? `Automation finding ${finding.id}: ${finding.message}`,
    requestedBy: input.actorId,
    supplierId: payload.preferredSupplierId ?? undefined,
    actorType: input.actorType,
    actorId: input.actorId
  });

  const resolvedFinding = await prisma.automationFinding.update({
    where: { id: finding.id },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
      suggestedActionJson: {
        ...payload,
        purchaseRequestId: purchaseRequest.id,
        actionResult: "DRAFT_PURCHASE_REQUEST_CREATED"
      }
    }
  });

  await writeAuditLog({
    actorType: input.actorType,
    actorId: input.actorId,
    action: "CREATE_DRAFT_PURCHASE_REQUEST_FROM_AUTOMATION_FINDING",
    entityType: "AutomationFinding",
    entityId: finding.id,
    payload: {
      purchaseRequestId: purchaseRequest.id,
      itemId: payload.itemId,
      quantity: payload.suggestedQuantity,
      note: "Automation created a draft purchase request only. It did not approve a purchase, place an order, or receive stock."
    }
  });

  return { finding: resolvedFinding, purchaseRequest };
}

export async function ignoreAutomationFinding(input: { findingId: string } & AutomationActor) {
  const finding = await prisma.automationFinding.findUnique({ where: { id: input.findingId } });
  if (!finding) throw new Error("Automation finding does not exist.");

  const updated = await prisma.automationFinding.update({
    where: { id: input.findingId },
    data: {
      status: "DISMISSED",
      resolvedAt: new Date()
    }
  });

  await writeAuditLog({
    actorType: input.actorType,
    actorId: input.actorId,
    action: "DISMISS_AUTOMATION_FINDING",
    entityType: "AutomationFinding",
    entityId: finding.id,
    payload: {
      category: finding.category,
      severity: finding.severity,
      dedupeKey: finding.dedupeKey,
      note: "Dismissed findings remain suppressed by dedupe key until manually restored or data changes create a new finding key."
    }
  });

  return updated;
}

export async function getAutomationOverview() {
  const [recentRuns, openFindings, failedRuns] = await Promise.all([
    prisma.automationRun.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { findings: true } }),
    prisma.automationFinding.findMany({ where: { status: "OPEN" }, orderBy: [{ severity: "desc" }, { createdAt: "desc" }], take: 50, include: { automationRun: true } }),
    prisma.automationRun.findMany({ where: { status: "FAILED" }, orderBy: { createdAt: "desc" }, take: 10 })
  ]);
  return { recentRuns, openFindings, failedRuns };
}

async function createRun(kind: AutomationRunKind, actor: AutomationActor, input: Prisma.InputJsonValue) {
  return prisma.automationRun.create({
    data: {
      kind,
      status: AutomationRunStatus.RUNNING,
      actorType: actor.actorType,
      actorId: actor.actorId,
      inputHash: hashJson(input),
      summaryJson: { input }
    }
  });
}

async function finishRun(id: string, status: AutomationRunStatus, summaryJson: Prisma.InputJsonValue) {
  return prisma.automationRun.update({
    where: { id },
    data: { status, finishedAt: new Date(), summaryJson }
  });
}

async function failRun(id: string, error: unknown) {
  return prisma.automationRun.update({
    where: { id },
    data: {
      status: AutomationRunStatus.FAILED,
      finishedAt: new Date(),
      errorMessage: error instanceof Error ? error.message : String(error)
    }
  });
}

async function recordFindings(
  automationRunId: string,
  findings: FindingInput[],
  options: { staleDedupePrefix?: string } = {}
) {
  const saved = [];
  const currentDedupeKeys = new Set(findings.map((finding) => finding.dedupeKey));
  for (const finding of findings) {
    const existing = await prisma.automationFinding.findUnique({ where: { dedupeKey: finding.dedupeKey } });
    if (existing?.status === "DISMISSED") continue;

    saved.push(await prisma.automationFinding.upsert({
      where: { dedupeKey: finding.dedupeKey },
      create: { automationRunId, ...finding },
      update: {
        automationRunId,
        severity: finding.severity,
        title: finding.title,
        message: finding.message,
        suggestedActionType: finding.suggestedActionType,
        suggestedActionJson: finding.suggestedActionJson,
        status: "OPEN",
        resolvedAt: null
      }
    }));
  }

  if (options.staleDedupePrefix) {
    await prisma.automationFinding.updateMany({
      where: {
        status: "OPEN",
        dedupeKey: { startsWith: options.staleDedupePrefix, notIn: Array.from(currentDedupeKeys) }
      },
      data: { status: "RESOLVED", resolvedAt: new Date() }
    });
  }

  return saved;
}

async function getIncomingSupplyByItem(itemIds: string[]) {
  const rows = await prisma.purchaseOrderLine.findMany({
    where: {
      itemId: { in: itemIds },
      purchaseOrder: { status: { in: [PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.ORDERED, PurchaseOrderStatus.PARTIALLY_RECEIVED] } }
    },
    select: { itemId: true, quantity: true, receivedQuantity: true }
  });
  return sumByItem(rows.map((row) => ({ itemId: row.itemId, quantity: Math.max(row.quantity - row.receivedQuantity, 0) })));
}

async function getOpenPurchaseRequestQuantityByItem(itemIds: string[]) {
  const rows = await prisma.purchaseRequestLine.findMany({
    where: {
      itemId: { in: itemIds },
      purchaseRequest: { status: { in: [PurchaseRequestStatus.DRAFT, PurchaseRequestStatus.PENDING_APPROVAL, PurchaseRequestStatus.APPROVED] } }
    },
    select: { itemId: true, quantity: true }
  });
  return sumByItem(rows);
}

function sumByItem(rows: Array<{ itemId: string; quantity: number }>) {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.itemId, (totals.get(row.itemId) ?? 0) + row.quantity);
  return totals;
}

function hashJson(input: Prisma.InputJsonValue) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

type DraftPurchaseRequestPayload = {
  itemId: string;
  suggestedQuantity: number;
  preferredSupplierId?: string | null;
  rationale?: string;
};

function parseDraftPurchaseRequestPayload(value: Prisma.JsonValue | null): DraftPurchaseRequestPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Automation finding has no structured draft purchase request payload.");
  }
  const payload = value as Record<string, unknown>;
  const itemId = payload.itemId;
  const suggestedQuantity = payload.suggestedQuantity;
  if (typeof itemId !== "string" || itemId.trim() === "") {
    throw new Error("Automation finding draft request is missing an item id.");
  }
  if (typeof suggestedQuantity !== "number" || !Number.isInteger(suggestedQuantity) || suggestedQuantity <= 0) {
    throw new Error("Automation finding draft request has an invalid suggested quantity.");
  }
  const preferredSupplierId = typeof payload.preferredSupplierId === "string" && payload.preferredSupplierId.trim() !== ""
    ? payload.preferredSupplierId
    : null;
  const rationale = typeof payload.rationale === "string" && payload.rationale.trim() !== ""
    ? payload.rationale
    : undefined;
  return { itemId, suggestedQuantity, preferredSupplierId, rationale };
}
