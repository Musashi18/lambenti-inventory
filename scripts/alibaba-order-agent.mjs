#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const envPath = path.join(projectRoot, ".env");

loadDotEnv(envPath);

const args = new Set(process.argv.slice(2));
const verbose = args.has("--verbose") || args.has("-v");
const jsonOnly = args.has("--json");
const baseUrl = (process.env.LAMBENTI_INVENTORY_BASE_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const secret = process.env.LAMBENTI_EMAIL_SYNC_SECRET;
const startedAt = new Date(Date.now() - 1_000);

try {
  const syncResult = await runSync();
  const shouldNotify = verbose || !syncResult.configured || syncResult.imported > 0 || (syncResult.errors?.length ?? 0) > 0;

  if (!shouldNotify) {
    process.exit(0);
  }

  const recentOrders = syncResult.imported > 0 ? await getOrdersCreatedSince(startedAt, syncResult.imported) : [];
  const payload = {
    sync: syncResult,
    newOrders: recentOrders,
    reviewUrl: `${baseUrl}/integrations/email-import`
  };

  if (jsonOnly) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(formatNotification(payload));
  }
} catch (error) {
  console.log(`Order email agent failed: ${error instanceof Error ? error.message : String(error)}\nOpen ${baseUrl}/integrations/email-import after the inventory app is running.`);
}

async function runSync() {
  const headers = { "content-type": "application/json" };
  if (secret) headers.authorization = `Bearer ${secret}`;

  let response;
  try {
    response = await fetch(`${baseUrl}/api/integrations/alibaba-email/sync`, {
      method: "POST",
      headers
    });
  } catch (error) {
    throw new Error(`could not reach inventory app at ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }

  let body;
  try {
    body = await response.json();
  } catch {
    body = { errors: [`HTTP ${response.status} ${response.statusText}`] };
  }

  if (!response.ok && response.status !== 503) {
    const detail = Array.isArray(body.errors) ? body.errors.join("; ") : body.error ?? response.statusText;
    throw new Error(`sync endpoint returned HTTP ${response.status}: ${detail}`);
  }

  return body;
}

async function getOrdersCreatedSince(startedAt, expectedCount) {
  const prisma = new PrismaClient();
  try {
    let imports = await prisma.emailOrderImport.findMany({
      where: { createdAt: { gte: startedAt } },
      orderBy: { createdAt: "desc" },
      take: Math.max(expectedCount, 1),
      include: {
        supplier: true,
        purchaseOrder: true,
        lines: { include: { matchedItem: true }, orderBy: { lineNo: "asc" } }
      }
    });

    // If a duplicate was refreshed instead of inserted during this sync, fall back to latest rows
    // so the notification still points the operator to concrete order details.
    if (imports.length === 0 && expectedCount > 0) {
      imports = await prisma.emailOrderImport.findMany({
        orderBy: { createdAt: "desc" },
        take: expectedCount,
        include: {
          supplier: true,
          purchaseOrder: true,
          lines: { include: { matchedItem: true }, orderBy: { lineNo: "asc" } }
        }
      });
    }

    return imports.map((order) => ({
      id: order.id,
      externalOrderId: order.externalOrderId,
      supplier: order.supplier?.name ?? order.supplierName,
      status: order.status,
      currency: order.currency,
      subtotal: decimalToString(order.subtotal),
      shippingCost: decimalToString(order.shippingCost),
      taxCost: decimalToString(order.taxCost),
      totalCost: decimalToString(order.totalCost),
      purchaseOrderId: order.purchaseOrder?.id ?? null,
      lines: order.lines.map((line) => ({
        description: line.rawDescription,
        matchedSku: line.matchedItem?.sku ?? null,
        quantity: line.quantity,
        unitPrice: decimalToString(line.unitPrice),
        lineTotal: decimalToString(line.lineTotal),
        shippingAllocated: decimalToString(line.shippingAllocated),
        landedUnitCost: decimalToString(line.landedUnitCost),
        matchConfidence: line.matchConfidence
      }))
    }));
  } finally {
    await prisma.$disconnect();
  }
}

function formatNotification({ sync, newOrders, reviewUrl }) {
  const lines = [];

  if (!sync.configured) {
    lines.push("Order email agent is not connected yet.");
    lines.push(...(sync.errors ?? []));
    lines.push(`Configure the mailbox in .env, then open ${reviewUrl}.`);
    return lines.join("\n");
  }

  if (sync.imported > 0) {
    lines.push(`Order email agent imported ${sync.imported} new order message${sync.imported === 1 ? "" : "s"}.`);
  } else {
    lines.push("Order email agent sync completed; no new supplier order messages were imported.");
  }

  lines.push(`Scanned ${sync.searchedMessages ?? 0}, fetched ${sync.fetchedMessages ?? 0}, duplicates ${sync.duplicates ?? 0}, applied/already applied ${sync.appliedOrAlreadyApplied ?? 0}, invoices ${sync.invoicesCreatedOrUpdated ?? 0}, needs review ${sync.needsReview ?? 0}, skipped ${sync.skipped ?? 0}.`);

  for (const order of newOrders) {
    lines.push("");
    lines.push(`Order ${order.externalOrderId ?? order.id} · ${order.supplier} · ${order.status}${order.purchaseOrderId ? ` · PO ${order.purchaseOrderId}` : ""}`);
    lines.push(`Total: ${order.currency} ${order.totalCost ?? "unknown"} · Subtotal: ${order.currency} ${order.subtotal ?? "unknown"} · Shipping: ${order.currency} ${order.shippingCost ?? "0"} · Tax: ${order.currency} ${order.taxCost ?? "0"}`);
    for (const line of order.lines) {
      lines.push(`- ${line.matchedSku ?? "Needs review"}: qty ${line.quantity}, unit ${order.currency} ${line.unitPrice ?? "unknown"}, line ${order.currency} ${line.lineTotal ?? "unknown"}, landed ${order.currency} ${line.landedUnitCost ?? "unknown"} (${line.matchConfidence}) — ${truncate(line.description, 96)}`);
    }
  }

  if ((sync.errors ?? []).length > 0) {
    lines.push("");
    lines.push(`Warnings: ${sync.errors.join("; ")}`);
  }

  lines.push("");
  lines.push(`Review/import details: ${reviewUrl}`);
  lines.push("No physical stock was received; receiving remains a separate human-approved inventory action.");
  return lines.join("\n");
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function decimalToString(value) {
  return value == null ? null : value.toString();
}

function truncate(value, maxLength) {
  if (!value || value.length <= maxLength) return value ?? "";
  return `${value.slice(0, maxLength - 1)}…`;
}
