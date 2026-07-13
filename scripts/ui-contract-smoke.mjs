#!/usr/bin/env node
import { chromium } from "playwright-core";

const defaultBaseUrl = "http://127.0.0.1:5173";
const baseUrl = readArg("base-url", process.env.LAMBENTI_INVENTORY_BASE_URL || defaultBaseUrl).replace(/\/$/, "");
const channel = process.env.LAMBENTI_QA_BROWSER_CHANNEL || "msedge";
const headless = process.env.HEADLESS === "0" ? false : true;

const markerContracts = [
  { path: "/", markers: ["Phase I Launch Readiness", "Signals", "Launch Target Meter", "Operations Flow", "Longest item planning windows", "Momentum Engine", "Conservatively classified founder activity", "Today's Work by Category"] },
  { path: "/tracking", markers: ["Fix Failed", "Refresh Due", "Link Evidence", "Review Open", "Last Good Refresh"] },
  { path: "/accounting", markers: ["Daily Bookkeeping Routine", "Evidence Only Until Apply", "Needs Manual Review", "Unreadable/No Text"] },
  { path: "/inventory/items", markers: ["Stock Health", "Below Reorder", "Needs Cost", "OK"] },
  { path: "/boms", markers: ["Build Constraint"] },
  { path: "/incoming", markers: ["Receiving Progress", "Quantity Counted"] },
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
    results.push(await checkSidebarLogoPersistence(browser));
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

    const sidebar = page.locator("aside").first();
    const logoButton = sidebar.getByRole("button", { name: "Edit sidebar logo image", exact: true });
    await logoButton.waitFor({ timeout: 10_000 });
    await page.locator("aside .lambenti-sidebar-logo").first().hover({ force: true });
    await sidebar.getByRole("button", { name: "Edit", exact: true }).waitFor({ timeout: 10_000 });
    const swapButtonCount = await sidebar.getByRole("button", { name: "Swap", exact: true }).count();
    const logoEvidence = await page.locator("aside .lambenti-sidebar-logo").first().evaluate((element) => {
      const image = element.querySelector(".lambenti-sidebar-logo-image");
      const imageStyle = image ? window.getComputedStyle(image) : null;
      const rect = element.getBoundingClientRect();
      const imageRect = image?.getBoundingClientRect();
      const elementStyle = window.getComputedStyle(element);
      return {
        src: image?.getAttribute("src") ?? null,
        height: Math.round(rect.height),
        imageAspectRatio: imageRect && imageRect.height > 0 ? Number((imageRect.width / imageRect.height).toFixed(3)) : null,
        naturalAspectRatio: image instanceof HTMLImageElement && image.naturalHeight > 0 ? Number((image.naturalWidth / image.naturalHeight).toFixed(3)) : null,
        objectFit: imageStyle?.objectFit ?? null,
        maskImage: imageStyle?.maskImage || imageStyle?.webkitMaskImage || null,
        edgeOpacity: elementStyle.getPropertyValue("--logo-edge-opacity").trim(),
        edgeStop: elementStyle.getPropertyValue("--logo-edge-stop").trim()
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
    if (swapButtonCount > 0) failures.push("Sidebar logo swap button should not render; replacement happens inside the edit modal dropbox");
    if (!logoEvidence.src) failures.push(`Sidebar logo image source missing: ${JSON.stringify(logoEvidence)}`);
    if (logoEvidence.height < 72) failures.push(`Sidebar logo editor frame too small: ${JSON.stringify(logoEvidence)}`);
    if (logoEvidence.objectFit !== "contain") failures.push(`Sidebar logo image should preserve aspect ratio with contain: ${JSON.stringify(logoEvidence)}`);
    if (logoEvidence.imageAspectRatio && logoEvidence.naturalAspectRatio && Math.abs(logoEvidence.imageAspectRatio - logoEvidence.naturalAspectRatio) > 0.03) failures.push(`Sidebar logo image aspect ratio is distorted: ${JSON.stringify(logoEvidence)}`);
    if (!logoEvidence.maskImage?.includes("radial-gradient")) failures.push(`Sidebar logo edge mask missing: ${JSON.stringify(logoEvidence)}`);
    if (!logoEvidence.edgeOpacity || !logoEvidence.edgeStop) failures.push(`Sidebar logo live blend variables missing: ${JSON.stringify(logoEvidence)}`);
    if (rows > 0 && hoverEvidence) {
      if (/248,\s*250,\s*252/.test(hoverEvidence.rowBackground) || /248,\s*250,\s*252/.test(hoverEvidence.stickyBackground ?? "")) failures.push(`Dark hover still uses light slate: ${JSON.stringify(hoverEvidence)}`);
      if (!/30,\s*41,\s*59/.test(hoverEvidence.rowBackground) || !/30,\s*41,\s*59/.test(hoverEvidence.stickyBackground ?? "")) failures.push(`Dark hover does not use slate-800 family: ${JSON.stringify(hoverEvidence)}`);
    }
    if (consoleErrors.length > 0) failures.push(`console errors: ${consoleErrors.join(" | ")}`);
    if (pageErrors.length > 0) failures.push(`page errors: ${pageErrors.join(" | ")}`);

    return { type: "sidebar-dark-hover", path: "/inventory/movements", status: response?.status() ?? null, sidebarText, titleEvidence, logoEvidence, swapButtonCount, rows, hoverEvidence, hoverSkipped, consoleErrors, pageErrors, failures };
  } finally {
    await page.close();
  }
}

async function checkSidebarLogoPersistence(browser) {
  const page = await browser.newPage();
  const { consoleErrors, pageErrors } = captureErrors(page);
  const currentLogo = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 120"%3E%3Crect width="180" height="120" fill="%23074047"/%3E%3Ccircle cx="90" cy="60" r="38" fill="none" stroke="%23d8b46a" stroke-width="6"/%3E%3C/svg%3E';
  const retiredLogo = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 120"%3E%3Crect width="180" height="120" fill="%23b91c1c"/%3E%3C/svg%3E';
  try {
    await page.addInitScript(({ currentLogo, retiredLogo }) => {
      window.localStorage.setItem("lambenti-theme", "dark");
      window.localStorage.setItem("lambenti-sidebar-logo-settings", JSON.stringify({ src: currentLogo, cropX: 7, cropY: -3, scale: 91, frameHeight: 126, edgeFade: 44, edgeOpacity: 52 }));
      window.localStorage.setItem("lambenti-sidebar-logo-layout-v2", JSON.stringify({ src: retiredLogo, cropX: -40, cropY: 40, scale: 44, frameHeight: 72, edgeFade: 15, edgeOpacity: 12 }));
    }, { currentLogo, retiredLogo });
    const response = await page.goto(`${baseUrl}/inventory/movements`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);

    const sidebar = page.locator("aside").first();
    await sidebar.getByRole("button", { name: "Edit sidebar logo image", exact: true }).click();
    const chooseImageCount = await page.getByRole("button", { name: "Choose Image", exact: true }).count();
    const dropboxCount = await page.getByText("Drop Logo Image Here").count();
    const evidence = await page.locator("aside .lambenti-sidebar-logo-image").first().evaluate((image) => ({
      src: image.getAttribute("src"),
      storedCurrent: window.localStorage.getItem("lambenti-sidebar-logo-settings"),
      retiredStorage: window.localStorage.getItem("lambenti-sidebar-logo-layout-v2")
    }));
    const storedCurrent = evidence.storedCurrent ? JSON.parse(evidence.storedCurrent) : null;
    const failures = [];
    if (response?.status() !== 200) failures.push(`HTTP ${response?.status() ?? "no response"}`);
    if (evidence.src !== currentLogo) failures.push(`Sidebar should render the current saved logo after refresh, not a retired/default logo: ${JSON.stringify(evidence)}`);
    if (storedCurrent?.src !== currentLogo) failures.push(`Current logo storage was not preserved as the single current source: ${JSON.stringify(evidence)}`);
    if (evidence.retiredStorage !== null) failures.push(`Retired logo storage should be removed after migration: ${JSON.stringify(evidence)}`);
    if (chooseImageCount < 1 || dropboxCount < 1) failures.push(`Edit modal dropbox missing: chooseImageCount=${chooseImageCount}, dropboxCount=${dropboxCount}`);
    if (consoleErrors.length > 0) failures.push(`console errors: ${consoleErrors.join(" | ")}`);
    if (pageErrors.length > 0) failures.push(`page errors: ${pageErrors.join(" | ")}`);
    return { type: "sidebar-logo-persistence", path: "/inventory/movements", status: response?.status() ?? null, evidence, chooseImageCount, dropboxCount, consoleErrors, pageErrors, failures };
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
