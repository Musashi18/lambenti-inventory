#!/usr/bin/env node
import { chromium } from "playwright-core";

const defaultBaseUrl = "http://127.0.0.1:5173";
const baseUrl = readArg("base-url", process.env.LAMBENTI_INVENTORY_BASE_URL || defaultBaseUrl).replace(/\/$/, "");
const channel = process.env.LAMBENTI_QA_BROWSER_CHANNEL || "msedge";
const headless = process.env.HEADLESS === "0" ? false : true;

const markerContracts = [
  { path: "/", markers: ["Phase I Launch Readiness", "Signals", "Launch Target Meter", "Operations Flow"] },
  { path: "/tracking", markers: ["Fix Failed", "Refresh Due", "Link Evidence", "Review Open", "Last Good Refresh"] },
  { path: "/accounting", markers: ["Daily Bookkeeping Routine", "Evidence Only Until Apply", "Needs Manual Review", "Unreadable/No Text"] },
  { path: "/inventory/items", markers: ["Stock Health", "Below Reorder", "Needs Cost", "OK"] },
  { path: "/boms", markers: ["Build Constraint"] },
  { path: "/incoming", markers: ["Receiving Progress", "Packing Slip Duplicate Check", "Quantity Counted"] },
  { path: "/inventory/valuation", markers: ["Value Concentration"] },
  { path: "/inventory/movements", markers: ["Ledger Reading Guide", "Ledger Impact", "Balance After Entry"] },
  { path: "/automation", markers: ["Severity Grouping"] }
];

async function main() {
  const browser = await chromium.launch({ channel, headless });
  const results = [];
  try {
    for (const contract of markerContracts) {
      const result = await checkMarkers(browser, contract);
      results.push(result.pageErrors.length > 0 ? await retryWithNote(result, () => checkMarkers(browser, contract)) : result);
    }
    const sidebarResult = await checkSidebarAndMovementHover(browser);
    results.push(sidebarResult.pageErrors.length > 0 ? await retryWithNote(sidebarResult, () => checkSidebarAndMovementHover(browser)) : sidebarResult);
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify({ baseUrl, results }, null, 2));
  if (results.some((result) => result.failures.length > 0)) process.exit(1);
}

async function checkMarkers(browser, { path, markers }) {
  const page = await browser.newPage();
  const { consoleErrors, pageErrors } = captureErrors(page);
  try {
    const response = await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    const bodyText = await page.locator("body").innerText({ timeout: 10_000 });
    const normalizedBodyText = bodyText.toLowerCase();
    const missing = markers.filter((marker) => !normalizedBodyText.includes(marker.toLowerCase()));
    const failures = [];
    if (response?.status() !== 200) failures.push(`HTTP ${response?.status() ?? "no response"}`);
    if (missing.length > 0) failures.push(`missing markers: ${missing.join(", ")}`);
    if (consoleErrors.length > 0) failures.push(`console errors: ${consoleErrors.join(" | ")}`);
    if (pageErrors.length > 0) failures.push(`page errors: ${pageErrors.join(" | ")}`);
    return { type: "markers", path, status: response?.status() ?? null, missing, consoleErrors, pageErrors, failures };
  } finally {
    await page.close();
  }
}

async function retryWithNote(firstResult, retryFn) {
  const retryResult = await retryFn();
  return {
    ...retryResult,
    retryOfTransientPageError: firstResult.pageErrors
  };
}

async function checkSidebarAndMovementHover(browser) {
  const page = await browser.newPage();
  const { consoleErrors, pageErrors } = captureErrors(page);
  try {
    await page.addInitScript(() => window.localStorage.setItem("lambenti-theme", "dark"));
    const response = await page.goto(`${baseUrl}/inventory/movements`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);

    const sidebarText = await page.locator("aside").innerText({ timeout: 10_000 });
    const title = page.locator("aside >> text=Inventory and Sourcing").first();
    await title.waitFor({ timeout: 10_000 });
    const titleEvidence = await title.evaluate((element) => {
      const style = window.getComputedStyle(element);
      const range = document.createRange();
      range.selectNodeContents(element);
      const textRect = range.getBoundingClientRect();
      const firstIcon = document.querySelector("aside nav a svg");
      const iconRect = firstIcon?.getBoundingClientRect();
      return {
        className: element.getAttribute("class"),
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        color: style.color,
        textLeft: Math.round(textRect.left),
        firstIconLeft: iconRect ? Math.round(iconRect.left) : null
      };
    });

    const rows = await page.locator(".table-row-interactive").count();
    let hoverEvidence = null;
    let hoverSkipped = false;
    if (rows > 0) {
      await page.locator(".table-row-interactive").first().hover();
      hoverEvidence = await page.locator(".table-row-interactive").first().evaluate((row) => {
        const sticky = row.querySelector(".table-sticky-cell");
        return {
          rowBackground: window.getComputedStyle(row).backgroundColor,
          stickyBackground: sticky ? window.getComputedStyle(sticky).backgroundColor : null
        };
      });
    } else {
      hoverSkipped = true;
    }

    const failures = [];
    if (response?.status() !== 200) failures.push(`HTTP ${response?.status() ?? "no response"}`);
    if (!sidebarText.includes("Inventory and Sourcing")) failures.push("Sidebar title missing");
    if (/\bLambenti\b/.test(sidebarText)) failures.push("Visible Lambenti text still present in sidebar");
    if (!titleEvidence.className?.includes("text-xl") || !titleEvidence.className?.includes("text-ink")) failures.push(`Sidebar title class mismatch: ${titleEvidence.className}`);
    if (titleEvidence.firstIconLeft === null || Math.abs(titleEvidence.textLeft - titleEvidence.firstIconLeft) > 2) failures.push(`Sidebar title not aligned with nav icons: title ${titleEvidence.textLeft}, icon ${titleEvidence.firstIconLeft}`);
    if (rows > 0 && hoverEvidence) {
      if (/248,\s*250,\s*252/.test(hoverEvidence.rowBackground) || /248,\s*250,\s*252/.test(hoverEvidence.stickyBackground ?? "")) failures.push(`Dark hover still uses light slate: ${JSON.stringify(hoverEvidence)}`);
      if (!/30,\s*41,\s*59/.test(hoverEvidence.rowBackground) || !/30,\s*41,\s*59/.test(hoverEvidence.stickyBackground ?? "")) failures.push(`Dark hover does not use slate-800 family: ${JSON.stringify(hoverEvidence)}`);
    }
    if (consoleErrors.length > 0) failures.push(`console errors: ${consoleErrors.join(" | ")}`);
    if (pageErrors.length > 0) failures.push(`page errors: ${pageErrors.join(" | ")}`);

    return { type: "sidebar-dark-hover", path: "/inventory/movements", status: response?.status() ?? null, sidebarText, titleEvidence, rows, hoverEvidence, hoverSkipped, consoleErrors, pageErrors, failures };
  } finally {
    await page.close();
  }
}

function captureErrors(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
}

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
