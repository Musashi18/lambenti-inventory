#!/usr/bin/env node
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.join(repoRoot, "qa-output");
const startedAt = new Date();

const args = new Set(process.argv.slice(2));
const help = args.has("--help") || args.has("-h");

if (help) {
  console.log(`Lambenti functional QA agent\n\nRuns the same checks a coding agent should use before declaring the inventory app functional:\n  1. stop stale Lambenti Next.js processes that can lock Prisma on Windows\n  2. apply Prisma migrations and regenerate Prisma Client\n  3. run Vitest and production build\n  4. start a production Next.js server on a free localhost port\n  5. smoke-test pages and agent APIs\n  6. browser-test item create, duplicate-SKU handling, edit dialog, persistence, and audit logging\n  7. clean up TEST-* verification records and write qa-output reports\n\nUsage:\n  npm run agent:functional\n  node scripts/functional-qa-agent.mjs [--skip-quality-gates] [--reuse-server=http://127.0.0.1:5173] [--no-browser]\n\nOptions:\n  --skip-quality-gates       Skip migrate/generate/test/build and only run runtime checks.\n  --reuse-server=<baseUrl>   Use an already-running app instead of starting Next.js.\n  --no-browser               Skip Playwright UI flow checks and run HTTP/API checks only.\n\nEnvironment:\n  LAMBENTI_QA_BROWSER_CHANNEL  Browser channel for Playwright, default: msedge.\n  HEADLESS=0                   Run browser headed instead of headless.\n`);
  process.exit(0);
}

dotenv.config({ path: path.join(repoRoot, ".env") });

let prisma = null;

function getPrisma() {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

const checks = [];
let serverProcess = null;
let browser = null;
let createdItemId = null;
let createdSku = null;
let createdTrackingImportId = null;
let createdTrackingPurchaseOrderId = null;
let createdTrackingInvoiceId = null;
let createdTrackingSupplierId = null;
let createdTrackingOrderId = null;
let trackingItemSnapshot = null;
let finalExitCode = 0;

const pageRoutes = [
  ["/", "Operations Dashboard"],
  ["/", "Human Approval Queue"],
  ["/inventory/items", "Inventory Items"],
  ["/inventory/movements", "Stock Movement History"],
  ["/inventory/valuation", "Inventory Valuation"],
  ["/suppliers", "Suppliers"],
  ["/purchasing/recommendations", "Purchase Recommendations"],
  ["/purchasing/requests", "Purchase Request Approvals"],
  ["/boms", "BOM Builder"],
  ["/incoming", "Incoming / Receiving"],
  ["/integrations/email-import", "Order Email Agent"],
  ["/integrations/alibaba-email", "Order Email Agent"],
  ["/automation", "Manual Safe Automation"],
  ["/tracking", "Tracking Workbench"],

  ["/accounting", "Accounting Workbench"],
  ["/accounting/accounts", "GL Account Mapping"],
  ["/accounting/customer-invoices", "Customer Invoices / AR"],
  ["/accounting/exports", "GST/HST Exports"],
  ["/accounting/invoices", "Accounting Invoices"],
  ["/accounting/journals", "Journal Entries"],
  ["/accounting/landed-cost", "Landed-Cost Allocation"],
  ["/accounting/payments", "Payment Reconciliation"]
];

const apiRoutes = [

  ["/api/agent/stock", 200, "array"],
  ["/api/agent/shortages", 200, "array"],
  ["/api/agent/boms", 200, "array"],
  ["/api/agent/supplier-offers", 200, "array"],
  ["/api/agent/purchase-requests", 405, "text"]
];

function logStep(message) {
  console.log(`\n▶ ${message}`);
}

function summarizeOutput(output, max = 6000) {
  if (output.length <= max) return output;
  return `${output.slice(0, 2000)}\n... [truncated ${output.length - max} chars] ...\n${output.slice(-4000)}`;
}

function commandForPlatform(command) {
  if (process.platform !== "win32") return command;
  if (command === "npm" || command === "npx") return `${command}.cmd`;
  return command;
}

function quoteWindowsCmdArg(value) {
  const arg = String(value);
  if (!/[\s"&|<>^]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function needsWindowsCmdShim(command, options) {
  // Windows cannot spawn .cmd shims such as npm.cmd/npx.cmd directly.
  // Launch them through cmd.exe instead of shell:true to avoid Node's
  // shell+args deprecation warning and the original spawn EINVAL failure.
  return typeof options.shell !== "boolean"
    && process.platform === "win32"
    && (command === "npm" || command === "npx");
}

function runCommand(command, commandArgs = [], options = {}) {
  const env = { ...process.env, CI: "1", ...options.env };
  const useWindowsCmdShim = needsWindowsCmdShim(command, options);
  const spawnCommand = useWindowsCmdShim ? "cmd.exe" : commandForPlatform(command);
  const spawnArgs = useWindowsCmdShim
    ? ["/d", "/s", "/c", [commandForPlatform(command), ...commandArgs].map(quoteWindowsCmdArg).join(" ")]
    : commandArgs;
  const shell = useWindowsCmdShim ? false : (options.shell ?? false);

  return new Promise((resolve, reject) => {
    const child = spawn(spawnCommand, spawnArgs, {
      cwd: options.cwd ?? repoRoot,
      env,
      shell,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let output = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      if (!options.quiet) process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      if (!options.quiet) process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const result = { command: [command, ...commandArgs].join(" "), exitCode: code ?? 0, output: summarizeOutput(output) };
      if (code === 0 || options.allowFailure) resolve(result);
      else {
        const error = new Error(`${result.command} exited with ${code}`);
        error.result = result;
        reject(error);
      }
    });
  });
}

async function check(name, fn) {
  const started = Date.now();
  try {
    const details = await fn();
    checks.push({ name, status: "pass", durationMs: Date.now() - started, details: details ?? null });
    console.log(`✓ ${name}`);
    return details;
  } catch (error) {
    checks.push({
      name,
      status: "fail",
      durationMs: Date.now() - started,
      error: error.stack || error.message || String(error),
      command: error.result?.command,
      commandOutput: error.result?.output
    });
    console.error(`✗ ${name}: ${error.message}`);
    throw error;
  }
}

function normalizeForMatch(value) {
  return value.replace(/\\/g, "/").toLowerCase();
}

async function stopRepoNextProcesses() {
  if (process.platform !== "win32") return { stopped: [] };

  const result = await runCommand(
    "wmic",
    ["process", "where", "name='node.exe'", "get", "ProcessId,CommandLine", "/FORMAT:LIST"],
    { allowFailure: true, quiet: true, shell: false }
  );

  const repoNeedle = normalizeForMatch(repoRoot);
  const normalized = result.output.replace(/\r+\n/g, "\n").replace(/\r/g, "\n");
  const records = [...normalized.matchAll(/CommandLine=(.*?)\nProcessId=(\d+)/gs)];
  const stopped = [];

  for (const [, commandLine, pid] of records) {
    const normalizedCommandLine = normalizeForMatch(commandLine);
    const isThisRepo = normalizedCommandLine.includes(repoNeedle);
    const isNextRuntime = /\bnext\b/.test(normalizedCommandLine) && /( dev| start|next\\|next\/)/.test(normalizedCommandLine);
    const isLambentiAutomation = /scripts\/(alibaba|alibaba-portal|alibaba-order)-agent\.mjs/.test(normalizedCommandLine)
      || /agent:alibaba/.test(normalizedCommandLine);
    const isCurrentProcess = Number(pid) === process.pid;

    if (((isThisRepo && isNextRuntime) || isLambentiAutomation) && !isCurrentProcess) {
      await runCommand("taskkill", ["/PID", pid, "/T", "/F"], { allowFailure: true, quiet: true, shell: false });
      stopped.push({ pid: Number(pid), commandLine: commandLine.trim() });
    }
  }

  return { stopped };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canUsePort(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

async function pickPort(startPort = 5173) {
  for (let port = startPort; port < startPort + 20; port += 1) {
    if (await canUsePort(port)) return port;
  }
  throw new Error(`No free localhost port found from ${startPort} to ${startPort + 19}.`);
}

async function waitForHttpOk(baseUrl, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    if (serverProcess?.exitCode !== null) {
      throw new Error(`Next.js server exited early with code ${serverProcess.exitCode}.`);
    }

    try {
      const response = await fetch(baseUrl, { cache: "no-store" });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(750);
  }

  throw new Error(`Timed out waiting for ${baseUrl}: ${lastError?.message ?? "no response"}`);
}

async function startNextServer(baseUrlFromArgs) {
  if (baseUrlFromArgs) {
    await waitForHttpOk(baseUrlFromArgs, 15000);
    return baseUrlFromArgs.replace(/\/$/, "");
  }

  const port = await pickPort(5173);
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverArgs = ["next", "start", "-H", "127.0.0.1", "-p", String(port)];
  const useWindowsCmdShim = needsWindowsCmdShim("npx", {});
  const spawnCommand = useWindowsCmdShim ? "cmd.exe" : commandForPlatform("npx");
  const spawnArgs = useWindowsCmdShim
    ? ["/d", "/s", "/c", [commandForPlatform("npx"), ...serverArgs].map(quoteWindowsCmdArg).join(" ")]
    : serverArgs;
  serverProcess = spawn(spawnCommand, spawnArgs, {
    cwd: repoRoot,
    shell: false,
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });

  serverProcess.stdout.on("data", (chunk) => process.stdout.write(chunk));
  serverProcess.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForHttpOk(baseUrl);
  return baseUrl;
}

function routeUrl(baseUrl, route) {
  return `${baseUrl}${route}`;
}

function assertNoRenderedAppError(route, body) {
  const forbidden = [
    "Application error",
    "Server Components render",
    "An error occurred in the Server Components render",
    "NEXT_REDIRECT"
  ];

  for (const marker of forbidden) {
    if (body.includes(marker)) throw new Error(`${route} rendered error marker: ${marker}`);
  }
}

async function verifyHttpRoutes(baseUrl) {
  const results = [];

  for (const [route, expectedText] of pageRoutes) {
    const response = await fetch(routeUrl(baseUrl, route), { cache: "no-store" });
    const body = await response.text();
    if (response.status !== 200) throw new Error(`${route} expected HTTP 200, got ${response.status}`);
    assertNoRenderedAppError(route, body);
    if (!body.includes(expectedText)) throw new Error(`${route} did not include expected text: ${expectedText}`);
    results.push({ route, status: response.status, expectedText });
  }

  for (const [route, expectedStatus, shape] of apiRoutes) {
    const response = await fetch(routeUrl(baseUrl, route), { cache: "no-store" });
    if (response.status !== expectedStatus) {
      throw new Error(`${route} expected HTTP ${expectedStatus}, got ${response.status}`);
    }

    if (expectedStatus === 200 && shape === "array") {
      const json = await response.json();
      if (!Array.isArray(json)) throw new Error(`${route} expected JSON array.`);
      results.push({ route, status: response.status, rows: json.length });
    } else {
      results.push({ route, status: response.status });
    }
  }

  return results;
}

async function launchBrowser() {
  const channel = process.env.LAMBENTI_QA_BROWSER_CHANNEL || "msedge";
  return chromium.launch({ channel, headless: process.env.HEADLESS !== "0" });
}

async function verifyBrowserPages(baseUrl) {
  browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];

  page.on("console", (message) => {
    const location = message.location();
    const isIgnorableFavicon404 = message.type() === "error"
      && message.text().includes("Failed to load resource")
      && location.url.endsWith("/favicon.ico");
    if (message.type() === "error" && !isIgnorableFavicon404) {
      consoleErrors.push(`${page.url()} :: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(`${page.url()} :: ${error.message}`));

  for (const [route, expectedText] of pageRoutes) {
    await page.goto(routeUrl(baseUrl, route), { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      (text) => document.body?.innerText.includes(text),
      expectedText,
      { timeout: 15000 }
    );
    const bodyText = await page.locator("body").innerText({ timeout: 10000 });
    if (!bodyText.includes(expectedText)) throw new Error(`Browser route ${route} missing visible text: ${expectedText}`);
    if (/Application error|Server Components render|Unhandled Runtime Error/i.test(bodyText)) {
      throw new Error(`Browser route ${route} rendered an app error.`);
    }
  }

  if (consoleErrors.length) {
    throw new Error(`Browser console/page errors:\n${consoleErrors.join("\n")}`);
  }

  await page.close();
  await context.close();
  return { checkedPages: pageRoutes.length };
}

async function cleanupOldQaItems() {
  const oldItems = await getPrisma().item.findMany({
    where: { sku: { startsWith: "TEST-QA-FUNC-" } },
    select: { id: true, sku: true }
  });

  if (!oldItems.length) return { deletedItems: 0 };

  const ids = oldItems.map((item) => item.id);
  await getPrisma().auditLog.deleteMany({ where: { entityId: { in: ids } } });
  await getPrisma().item.deleteMany({ where: { id: { in: ids } } });
  return { deletedItems: oldItems.length, skus: oldItems.map((item) => item.sku) };
}

async function waitForDb(predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;

  while (Date.now() < deadline) {
    lastValue = await predicate();
    if (lastValue) return lastValue;
    await sleep(300);
  }

  throw new Error(`Timed out waiting for database state. Last value: ${JSON.stringify(lastValue)}`);
}

async function fillCreateItemForm(page, sku, description) {
  const form = page.locator("form", { has: page.getByRole("button", { name: /Create Item/i }) }).first();
  await form.locator('input[name="sku"]').fill(sku);
  await form.locator('input[name="manufacturerPartNo"]').fill("TEST-MPN");
  await form.locator('input[name="supplierSku"]').fill("TEST-SUPPLIER-SKU");
  await form.locator('input[name="description"]').fill(description);
  await form.locator('input[name="reorderPoint"]').fill("1");
  await form.locator('input[name="targetStock"]').fill("2");
  await form.locator('input[name="leadTimeDays"]').fill("3");
  await form.locator('input[name="estimatedUnitCost"]').fill("0.01");
  await form.locator('input[name="costCurrency"]').fill("USD");
  await form.locator('input[name="costSourceRef"]').fill(`TEST-QA ${sku}`);
}

async function verifyItemCreateDuplicateEditFlow(baseUrl) {
  await cleanupOldQaItems();

  const storageLocationCount = await getPrisma().storageLocation.count();
  if (storageLocationCount < 1) {
    throw new Error("No storage locations exist. The item create form correctly blocks item creation until one exists.");
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  createdSku = `TEST-QA-FUNC-${Date.now()}`;
  const initialDescription = `TEST-QA functional item ${createdSku}`;
  const editedDescription = `${initialDescription} edited`;

  await page.goto(routeUrl(baseUrl, "/inventory/items"), { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Inventory Items/i }).waitFor({ timeout: 10000 });

  await fillCreateItemForm(page, createdSku, initialDescription);
  await page.getByRole("button", { name: /Create Item/i }).click();
  await page.getByText(`Created item ${createdSku}`, { exact: false }).waitFor({ timeout: 15000 });

  const created = await waitForDb(() => getPrisma().item.findUnique({ where: { sku: createdSku } }));
  createdItemId = created.id;

  await fillCreateItemForm(page, createdSku, initialDescription);
  await page.getByRole("button", { name: /Create Item/i }).click();
  await page.getByText(/That SKU already exists/i).waitFor({ timeout: 15000 });
  const duplicateCount = await getPrisma().item.count({ where: { sku: createdSku } });
  if (duplicateCount !== 1) throw new Error(`Duplicate SKU flow created ${duplicateCount} records instead of 1.`);

  const row = page.getByRole("row", { name: new RegExp(createdSku) });
  await row.getByRole("button", { name: /^Edit$/ }).click();
  const dialog = page.locator("dialog[open]").first();
  await dialog.waitFor({ timeout: 10000 });
  await dialog.locator('input[name="description"]').fill(editedDescription);
  await dialog.getByRole("button", { name: /Save Changes/i }).click();

  const edited = await waitForDb(async () => {
    const item = await getPrisma().item.findUnique({ where: { sku: createdSku } });
    return item?.description === editedDescription ? item : null;
  });

  const auditCount = await getPrisma().auditLog.count({
    where: {
      entityId: edited.id,
      action: { in: ["CREATE_ITEM", "UPDATE_ITEM"] }
    }
  });
  if (auditCount < 2) throw new Error(`Expected create/update audit logs for ${createdSku}, found ${auditCount}.`);

  if (consoleErrors.length) {
    throw new Error(`Console/page errors during item flow:\n${consoleErrors.join("\n")}`);
  }

  await page.close();
  await context.close();
  return { sku: createdSku, itemId: createdItemId, auditCount };
}

function authHeadersForLocalAutomation() {
  const secret = process.env.LAMBENTI_ALIBABA_AGENT_SECRET ?? process.env.LAMBENTI_EMAIL_SYNC_SECRET;
  return secret ? { authorization: `Bearer ${secret}` } : {};
}

async function verifyAutomaticTrackingImportFlow(baseUrl) {
  const db = getPrisma();
  const itemSku = "LED-COB-12V-3000K";
  const trackedItem = await db.item.findUnique({
    where: { sku: itemSku },
    select: {
      id: true,
      sku: true,
      estimatedUnitCost: true,
      costCurrency: true,
      costConfidence: true,
      costSourceRef: true,
      preferredSupplierId: true,
      supplierSku: true
    }
  });

  if (!trackedItem) throw new Error(`Required seed item ${itemSku} does not exist; cannot verify automatic tracking import flow.`);
  trackingItemSnapshot = trackedItem;

  const stockMovementCountBefore = await db.stockMovement.count({ where: { itemId: trackedItem.id } });
  const runId = `TEST-QA-AUTO-${Date.now()}`;
  createdTrackingOrderId = runId;
  const supplierName = `TEST-QA Automation Supplier ${runId}`;
  const invoiceHash = `TEST-QA-SHA256-${runId}`;

  const response = await fetch(routeUrl(baseUrl, "/api/integrations/alibaba-portal/import"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeadersForLocalAutomation()
    },
    body: JSON.stringify({
      actorId: "functional-qa-agent",
      autoApply: true,
      autoCreateInvoices: true,
      snapshots: [
        {
          sourceUrl: `https://example.alibaba.test/orders/${runId}`,
          pageTitle: `Alibaba order ${runId}`,
          capturedAt: new Date().toISOString(),
          orderId: runId,
          supplierName,
          text: [
            `Order Number: ${runId}`,
            `Supplier: ${supplierName}`,
            `Product: ${itemSku} 12 V COB LED strip 3000K qty 3 unit price USD 1.23 total USD 3.69`,
            "Shipping: USD 0.30",
            "Total: USD 3.99"
          ].join("\n"),
          invoiceDocuments: [
            {
              fileName: `${runId}.pdf`,
              localPath: `var/alibaba-invoices/${runId}.pdf`,
              sourceUrl: `https://example.alibaba.test/invoices/${runId}`,
              sha256: invoiceHash,
              downloadedAt: new Date().toISOString(),
              text: [
                `Commercial invoice number INV-${runId}`,
                `Supplier: ${supplierName}`,
                `Order Number: ${runId}`,
                `Product: ${itemSku} qty 3 unit price USD 1.23 total USD 3.69`,
                "Shipping: USD 0.30",
                "Total: USD 3.99"
              ].join("\n")
            }
          ]
        }
      ]
    })
  });

  const body = await response.json();
  if (response.status !== 200) {
    throw new Error(`Alibaba portal import expected HTTP 200, got ${response.status}: ${JSON.stringify(body)}`);
  }
  if (body.errors?.length) throw new Error(`Alibaba portal import returned errors: ${body.errors.join("; ")}`);
  if (body.imported !== 1 || body.appliedOrAlreadyApplied !== 1 || body.invoicesCreatedOrUpdated !== 1) {
    throw new Error(`Alibaba portal import did not create the expected linked records: ${JSON.stringify(body)}`);
  }

  const orderImport = await db.emailOrderImport.findFirst({
    where: {
      OR: [
        { externalOrderId: runId },
        { sourceMessageId: `<alibaba-portal:${runId}>` },
        { rawText: { contains: runId } }
      ]
    },
    include: {
      supplier: true,
      lines: { include: { matchedItem: true } },
      purchaseOrder: { include: { lines: { include: { item: true } } } }
    },
    orderBy: { createdAt: "desc" }
  });

  if (!orderImport) throw new Error(`Could not find EmailOrderImport for ${runId} after API import.`);
  createdTrackingImportId = orderImport.id;
  createdTrackingSupplierId = orderImport.supplierId;
  createdTrackingPurchaseOrderId = orderImport.purchaseOrderId;

  const matchedLine = orderImport.lines.find((line) => line.matchedItem?.sku === itemSku);
  if (!matchedLine) throw new Error(`Automatic import did not match ${itemSku}: ${JSON.stringify(orderImport.lines)}`);
  if (orderImport.status !== "APPLIED") throw new Error(`Expected import status APPLIED, got ${orderImport.status}.`);
  if (!orderImport.purchaseOrder) throw new Error("Automatic import did not create an incoming purchase order.");
  if (orderImport.purchaseOrder.status !== "ORDERED") throw new Error(`Expected PO status ORDERED, got ${orderImport.purchaseOrder.status}.`);

  const poLine = orderImport.purchaseOrder.lines.find((line) => line.item.sku === itemSku);
  if (!poLine) throw new Error(`Purchase order does not contain ${itemSku}.`);
  if (poLine.quantity !== 3) throw new Error(`Expected PO quantity 3, got ${poLine.quantity}.`);
  if (poLine.receivedQuantity !== 0) throw new Error(`Automatic tracking must not receive stock; PO receivedQuantity is ${poLine.receivedQuantity}.`);

  const invoice = await db.supplierInvoice.findUnique({
    where: { purchaseOrderId: orderImport.purchaseOrder.id },
    include: { lines: true }
  });
  if (!invoice) throw new Error("Automatic import did not create supplier invoice/accounting record.");
  createdTrackingInvoiceId = invoice.id;
  if (invoice.status !== "RECEIVED") throw new Error(`Expected invoice status RECEIVED, got ${invoice.status}.`);
  if (invoice.sourceDocumentHash !== invoiceHash) throw new Error("Invoice provenance hash was not preserved from portal document.");

  const stockMovementCountAfter = await db.stockMovement.count({ where: { itemId: trackedItem.id } });
  if (stockMovementCountAfter !== stockMovementCountBefore) {
    throw new Error(`Automatic tracking created stock movement rows (${stockMovementCountBefore} -> ${stockMovementCountAfter}); receiving must remain human-approved.`);
  }

  return {
    importId: orderImport.id,
    purchaseOrderId: orderImport.purchaseOrder.id,
    invoiceId: invoice.id,
    matchedSku: itemSku,
    receivedQuantity: poLine.receivedQuantity,
    stockMovementsCreated: stockMovementCountAfter - stockMovementCountBefore
  };
}

async function cleanupRunArtifacts() {
  const cleanup = {
    itemDeleted: false,
    trackingItemRestored: false,
    trackingInvoiceDeleted: false,
    trackingImportDeleted: false,
    trackingPurchaseOrderDeleted: false,
    trackingSupplierDeleted: false,
    auditLogsDeleted: 0,
    agentActionsDeleted: 0
  };

  const needsDatabaseCleanup = Boolean(
    createdSku
    || createdTrackingOrderId
    || createdTrackingImportId
    || createdTrackingPurchaseOrderId
    || createdTrackingInvoiceId
    || createdTrackingSupplierId
    || trackingItemSnapshot
    || checks.some((entry) => [
      "HTTP page/API smoke tests",
      "Browser item create, duplicate-SKU, edit, persistence, and audit flow",
      "Automatic tracking import-to-PO/invoice flow"
    ].includes(entry.name))
  );

  if (!needsDatabaseCleanup) return cleanup;

  const db = getPrisma();

  try {
    if (trackingItemSnapshot) {
      await db.item.update({
        where: { id: trackingItemSnapshot.id },
        data: {
          estimatedUnitCost: trackingItemSnapshot.estimatedUnitCost,
          costCurrency: trackingItemSnapshot.costCurrency,
          costConfidence: trackingItemSnapshot.costConfidence,
          costSourceRef: trackingItemSnapshot.costSourceRef,
          preferredSupplierId: trackingItemSnapshot.preferredSupplierId,
          supplierSku: trackingItemSnapshot.supplierSku
        }
      });
      cleanup.trackingItemRestored = true;
    }

    if (!createdTrackingImportId && createdTrackingOrderId) {
      const orderImport = await db.emailOrderImport.findFirst({
        where: { rawText: { contains: createdTrackingOrderId } },
        select: { id: true, purchaseOrderId: true, supplierId: true }
      });
      if (orderImport) {
        createdTrackingImportId = orderImport.id;
        createdTrackingPurchaseOrderId = createdTrackingPurchaseOrderId ?? orderImport.purchaseOrderId;
        createdTrackingSupplierId = createdTrackingSupplierId ?? orderImport.supplierId;
      }
    }

    if (!createdTrackingInvoiceId && createdTrackingPurchaseOrderId) {
      const invoice = await db.supplierInvoice.findUnique({
        where: { purchaseOrderId: createdTrackingPurchaseOrderId },
        select: { id: true }
      });
      createdTrackingInvoiceId = invoice?.id ?? null;
    }

    if (createdTrackingInvoiceId) {
      await db.supplierInvoiceLine.deleteMany({ where: { invoiceId: createdTrackingInvoiceId } });
      const deleted = await db.supplierInvoice.deleteMany({ where: { id: createdTrackingInvoiceId } });
      cleanup.trackingInvoiceDeleted = deleted.count > 0;
    }

    if (createdTrackingImportId) {
      await db.emailOrderLineImport.deleteMany({ where: { importId: createdTrackingImportId } });
      const deleted = await db.emailOrderImport.deleteMany({ where: { id: createdTrackingImportId } });
      cleanup.trackingImportDeleted = deleted.count > 0;
    }

    if (createdTrackingPurchaseOrderId) {
      await db.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: createdTrackingPurchaseOrderId } });
      const deleted = await db.purchaseOrder.deleteMany({ where: { id: createdTrackingPurchaseOrderId } });
      cleanup.trackingPurchaseOrderDeleted = deleted.count > 0;
    }

    if (createdTrackingSupplierId) {
      const deleted = await db.supplier.deleteMany({
        where: {
          id: createdTrackingSupplierId,
          name: { startsWith: "TEST-QA Automation Supplier" }
        }
      });
      cleanup.trackingSupplierDeleted = deleted.count > 0;
    }

    if (createdSku) {
      const item = await db.item.findUnique({ where: { sku: createdSku }, select: { id: true } });
      if (item) {
        await db.auditLog.deleteMany({ where: { entityId: item.id } });
        await db.item.delete({ where: { id: item.id } });
        cleanup.itemDeleted = true;
      }
    }

    const deletedAuditLogs = await db.auditLog.deleteMany({
      where: {
        actorId: "functional-qa-agent",
        createdAt: { gte: startedAt }
      }
    });
    cleanup.auditLogsDeleted = deletedAuditLogs.count;

    const deletedAgentActions = await db.agentAction.deleteMany({
      where: {
        agentName: "external-agent",
        createdAt: { gte: startedAt }
      }
    });
    cleanup.agentActionsDeleted = deletedAgentActions.count;
  } catch (error) {
    cleanup.error = error.stack || error.message || String(error);
    finalExitCode = 1;
  }

  return cleanup;
}

async function writeReports(extra = {}) {
  await fs.mkdir(outputDir, { recursive: true });
  const report = {
    app: "Lambenti Inventory",
    agent: "functional-qa-agent",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    repoRoot,
    ok: checks.every((entry) => entry.status === "pass") && !extra.cleanup?.error,
    checks,
    ...extra
  };

  const jsonPath = path.join(outputDir, "functional-qa-agent-report.json");
  const mdPath = path.join(outputDir, "functional-qa-agent-report.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const rows = checks.map((entry) => {
    const detail = entry.status === "pass"
      ? (entry.details ? `<code>${JSON.stringify(entry.details).slice(0, 180)}</code>` : "")
      : entry.error.replace(/\n/g, "<br>").slice(0, 500);
    return `| ${entry.status === "pass" ? "PASS" : "FAIL"} | ${entry.name} | ${entry.durationMs} | ${detail} |`;
  }).join("\n");

  const markdown = [
    "# Lambenti Functional QA Agent Report",
    "",
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    `- Result: **${report.ok ? "PASS" : "FAIL"}**`,
    `- Repo: \`${repoRoot}\``,
    "",
    "| Status | Check | Duration ms | Details |",
    "|---|---:|---:|---|",
    rows,
    "",
    `Cleanup: \`${JSON.stringify(extra.cleanup ?? {})}\``,
    ""
  ].join("\n");

  await fs.writeFile(mdPath, markdown, "utf8");

  return { jsonPath, mdPath, report };
}

async function shutdown() {
  if (browser) await browser.close().catch(() => {});
  if (serverProcess && serverProcess.exitCode === null) {
    if (process.platform === "win32") {
      await runCommand("taskkill", ["/PID", String(serverProcess.pid), "/T", "/F"], { allowFailure: true, quiet: true, shell: false });
    } else {
      serverProcess.kill("SIGTERM");
    }
  }
  if (prisma) await prisma.$disconnect().catch(() => {});
}

async function main() {
  const reuseArg = [...args].find((arg) => arg.startsWith("--reuse-server="));
  const reuseServerBaseUrl = reuseArg ? reuseArg.split("=").slice(1).join("=") : null;
  const runQualityGates = !args.has("--skip-quality-gates") && !reuseServerBaseUrl;
  const runBrowserChecks = !args.has("--no-browser");
  let baseUrl = reuseServerBaseUrl;

  if (runQualityGates) {
    await check("Stop stale Lambenti Next.js processes", stopRepoNextProcesses);
    logStep("Applying Prisma migrations");
    await check("Prisma migrate deploy", () => runCommand("npx", ["prisma", "migrate", "deploy"]));
    logStep("Generating Prisma Client");
    await check("Prisma generate", () => runCommand("npx", ["prisma", "generate"]));
    logStep("Running Vitest");
    await check("Vitest unit/business tests", () => runCommand("npm", ["run", "test", "--", "--run"]));
    logStep("Building production app");
    await check("Next.js production build", () => runCommand("npm", ["run", "build"]));
  }

  baseUrl = await check("Start or verify production server", () => startNextServer(baseUrl));
  await check("HTTP page/API smoke tests", () => verifyHttpRoutes(baseUrl));
  await check("Automatic tracking import-to-PO/invoice flow", () => verifyAutomaticTrackingImportFlow(baseUrl));

  if (runBrowserChecks) {
    if (!browser) browser = await launchBrowser();
    await check("Browser page smoke tests with console-error detection", () => verifyBrowserPages(baseUrl));
    await check("Browser item create, duplicate-SKU, edit, persistence, and audit flow", () => verifyItemCreateDuplicateEditFlow(baseUrl));
  }
}

try {
  await main();
} catch (error) {
  finalExitCode = 1;
  console.error("\nFunctional QA agent failed.");
  console.error(error.stack || error.message || String(error));
} finally {
  const cleanup = await cleanupRunArtifacts();
  const { jsonPath, mdPath, report } = await writeReports({ cleanup });
  await shutdown();

  console.log(`\nReport written:\n- ${jsonPath}\n- ${mdPath}`);
  if (report.ok) console.log("\nLambenti functional QA agent PASS.");
  else console.log("\nLambenti functional QA agent FAIL. See report for details.");
  process.exit(finalExitCode);
}
