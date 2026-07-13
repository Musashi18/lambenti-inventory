#!/usr/bin/env node
import { chromium } from "playwright-core";

const host = "127.0.0.1";
const defaultBaseUrl = `http://${host}:5173`;
const baseUrl = readBaseUrl();
const channel = process.env.LAMBENTI_QA_BROWSER_CHANNEL || "msedge";
const headless = process.env.HEADLESS === "0" ? false : true;

const pageRoutes = [
  ["/", "Operations Dashboard"],
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

async function main() {
  const browser = await chromium.launch({ channel, headless });
  const context = await browser.newContext();
  const failures = [];

  try {
    for (const [route, expectedText] of pageRoutes) {
      const page = await context.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));

      try {
        const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
        if (!response?.ok()) {
          throw new Error(`HTTP ${response?.status() ?? "no response"}`);
        }
        await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
        const bodyText = await page.locator("body").innerText({ timeout: 10_000 });
        if (!bodyText.includes(expectedText)) {
          throw new Error(`missing expected text: ${expectedText}`);
        }
        if (consoleErrors.length || pageErrors.length) {
          throw new Error(`console/page errors: ${[...consoleErrors, ...pageErrors].join(" | ")}`);
        }
        console.log(`BROWSER ${route} OK`);
      } catch (error) {
        failures.push({ route, error: error instanceof Error ? error.message : String(error) });
        console.error(`BROWSER ${route} FAIL: ${failures.at(-1).error}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  if (failures.length) {
    console.error(JSON.stringify({ baseUrl, failures }, null, 2));
    process.exit(1);
  }

  console.log(`Browser section smoke passed: ${pageRoutes.length} pages at ${baseUrl}`);
}

function readBaseUrl() {
  const arg = process.argv.find((value) => value.startsWith("--base-url="));
  return (arg ? arg.slice("--base-url=".length) : process.env.LAMBENTI_INVENTORY_BASE_URL || defaultBaseUrl).replace(/\/$/, "");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
