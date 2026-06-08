#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { detectAlibabaAuthState, looksLikeGoogleChromePath } from "./alibaba-portal-auth.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const envPath = path.join(projectRoot, ".env");

loadDotEnv(envPath);

const args = new Set(process.argv.slice(2));
const verbose = args.has("--verbose") || args.has("-v");
const jsonOnly = args.has("--json");
const dryRun = args.has("--dry-run");
const setupLogin = args.has("--setup-login") || args.has("--login");
const headless = args.has("--headless") || /^true$/i.test(process.env.LAMBENTI_ALIBABA_HEADLESS ?? "");
const autoSubmitSavedLogin = !args.has("--no-auto-submit-saved-login") && !/^false$/i.test(process.env.LAMBENTI_ALIBABA_AUTO_SUBMIT_SAVED_LOGIN ?? "true");
const authSettleMs = positiveInt(process.env.LAMBENTI_ALIBABA_AUTH_SETTLE_MS, 2_000);
const browserStartupSettleMs = positiveInt(process.env.LAMBENTI_ALIBABA_BROWSER_STARTUP_SETTLE_MS, 2_000);
const loginSettleMs = positiveInt(process.env.LAMBENTI_ALIBABA_LOGIN_SETTLE_MS, 5_000);
const maxCandidates = positiveInt(process.env.LAMBENTI_ALIBABA_MAX_LINKS, args.has("--deep") ? 30 : 12);
const baseUrl = (process.env.LAMBENTI_INVENTORY_BASE_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const secret = process.env.LAMBENTI_ALIBABA_AGENT_SECRET ?? process.env.LAMBENTI_EMAIL_SYNC_SECRET;
const startUrl = process.env.LAMBENTI_ALIBABA_ORDERS_URL ?? "https://www.alibaba.com/trade/order/list.htm";
const messagesUrl = process.env.LAMBENTI_ALIBABA_MESSAGES_URL ?? "https://message.alibaba.com/";
const userDataDir = path.resolve(projectRoot, process.env.LAMBENTI_ALIBABA_BROWSER_PROFILE_DIR ?? "var/alibaba-chrome-profile");
const downloadsDir = path.resolve(projectRoot, process.env.LAMBENTI_ALIBABA_INVOICE_DIR ?? "var/alibaba-invoices");
const statePath = path.resolve(projectRoot, "var/alibaba-portal-agent-state.json");

try {
  const result = await run();
  const shouldNotify = verbose || jsonOnly || dryRun || result.loginRequired || result.imported > 0 || result.invoicesCreatedOrUpdated > 0 || result.errors.length > 0;

  if (!shouldNotify) process.exit(0);

  if (jsonOnly || dryRun) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatResult(result));
  }
} catch (error) {
  console.log(`Alibaba portal agent failed: ${error instanceof Error ? error.message : String(error)}`);
}

async function run() {
  fs.mkdirSync(downloadsDir, { recursive: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(path.dirname(statePath), { recursive: true });

  const { chromium } = await importPlaywright();
  const executablePath = findChromeExecutable();
  if (!executablePath) {
    return emptyResult({
      configured: false,
      errors: ["No Google Chrome executable found. Install Google Chrome or set LAMBENTI_ALIBABA_BROWSER_EXECUTABLE_PATH to chrome.exe in .env."]
    });
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless,
    acceptDownloads: true,
    downloadsPath: downloadsDir,
    viewport: { width: 1440, height: 1000 },
    locale: "en-US"
  });

  try {
    const page = context.pages()[0] ?? await context.newPage();
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(60_000);
    if (browserStartupSettleMs > 0) await page.waitForTimeout(browserStartupSettleMs);

    if (setupLogin) {
      await page.goto(startUrl, { waitUntil: "domcontentloaded" });
      console.log("Alibaba login setup opened in Google Chrome.");
      console.log("1. Sign into Alibaba in the opened Chrome window, including any 2FA/security/CAPTCHA checks.");
      console.log("   Security/CAPTCHA checks must be completed manually; this agent will not bypass them.");
      console.log("2. Open the Alibaba order/message center once so cookies are fully established.");
      console.log("3. If Chrome asks to save the password/session, allow it if you want auto-submit from saved Chrome info later.");
      console.log("4. Return here and press Enter. The agent will reuse this Chrome profile for scheduled runs.");
      await waitForEnter();
      await context.storageState({ path: path.join(userDataDir, "storage-state.json") });
      clearManualInterventionReminders();
      return {
        ...emptyResult(),
        setupComplete: true,
        message: `Alibaba Chrome session saved in ${relativeProjectPath(userDataDir)}.`
      };
    }

    const snapshots = [];
    const errors = [];
    let loginRequired = false;
    let securityChallengeRequired = false;
    let autoLoginAttempted = false;

    for (const target of [
      { url: startUrl, kind: "orders" },
      { url: messagesUrl, kind: "messages" }
    ]) {
      try {
        await page.goto(target.url, { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => undefined);
        if (authSettleMs > 0) await page.waitForTimeout(authSettleMs);

        const authState = await ensureAlibabaAuthenticated(page);
        loginRequired = loginRequired || authState.loginRequired;
        securityChallengeRequired = securityChallengeRequired || authState.securityChallengeRequired;
        autoLoginAttempted = autoLoginAttempted || authState.autoLoginAttempted;
        if (authState.loginRequired || authState.securityChallengeRequired) continue;

        snapshots.push(...(await collectPortalSnapshots(context, page, target.kind)));
      } catch (error) {
        errors.push(`${target.kind}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const uniqueSnapshots = uniqueBySnapshotIdentity(snapshots).slice(0, positiveInt(process.env.LAMBENTI_ALIBABA_MAX_SNAPSHOTS, 20));

    if (securityChallengeRequired && uniqueSnapshots.length === 0) {
      const shouldRemind = shouldEmitChallengeReminder();
      return emptyResult({
        securityChallengeRequired: shouldRemind,
        autoLoginAttempted,
        errors: shouldRemind ? ["Alibaba is showing a security/CAPTCHA/verification check. This agent cannot bypass it. Run `npm run agent:alibaba-login`, complete the check in Chrome, then press Enter in the terminal."] : []
      });
    }

    if (loginRequired && uniqueSnapshots.length === 0) {
      const shouldRemind = shouldEmitLoginReminder();
      return emptyResult({
        loginRequired: shouldRemind,
        autoLoginAttempted,
        errors: shouldRemind ? [autoLoginAttempted
          ? "Alibaba still requires manual login after trying Chrome's saved/autofilled login info. Run `npm run agent:alibaba-login`, sign in in Chrome, then press Enter in the terminal."
          : "Alibaba login is required. Run `npm run agent:alibaba-login`, sign in in Chrome, then press Enter in the terminal."] : []
      });
    }

    clearManualInterventionReminders();

    if (dryRun) {
      return {
        configured: true,
        loginRequired: false,
        securityChallengeRequired: false,
        autoLoginAttempted,
        capturedSnapshots: uniqueSnapshots.length,
        imported: 0,
        duplicates: 0,
        appliedOrAlreadyApplied: 0,
        invoicesCreatedOrUpdated: 0,
        needsReview: 0,
        errors,
        snapshots: uniqueSnapshots
      };
    }

    if (uniqueSnapshots.length === 0) {
      return emptyResult({ configured: true, errors });
    }

    const importResult = await uploadSnapshots(uniqueSnapshots);
    return {
      configured: true,
      loginRequired: false,
      securityChallengeRequired: false,
      autoLoginAttempted,
      capturedSnapshots: uniqueSnapshots.length,
      imported: importResult.imported ?? 0,
      duplicates: importResult.duplicates ?? 0,
      appliedOrAlreadyApplied: importResult.appliedOrAlreadyApplied ?? 0,
      invoicesCreatedOrUpdated: importResult.invoicesCreatedOrUpdated ?? 0,
      needsReview: importResult.needsReview ?? 0,
      errors: [...errors, ...(importResult.errors ?? [])],
      reviewUrl: `${baseUrl}/integrations/alibaba-email`,
      invoicesUrl: `${baseUrl}/accounting/invoices`
    };
  } finally {
    await context.close();
  }
}

async function collectPortalSnapshots(context, page, kind) {
  const snapshots = [];
  const currentDocs = await downloadInvoiceDocuments(page);
  const currentSnapshot = await snapshotFromPage(page, kind, currentDocs);
  if (currentSnapshot) snapshots.push(currentSnapshot);

  const candidateCount = await markCandidates(page, "detail", maxCandidates);
  for (let index = 0; index < candidateCount; index += 1) {
    const selector = `[data-alibaba-agent-detail="${index}"]`;
    const locator = page.locator(selector).first();
    const beforeUrl = page.url();

    try {
      const popupPromise = context.waitForEvent("page", { timeout: 5_000 }).catch(() => null);
      const downloadPromise = page.waitForEvent("download", { timeout: 5_000 }).catch(() => null);
      await locator.click({ timeout: 10_000 });
      const download = await downloadPromise;
      const popup = await popupPromise;

      if (download) {
        const document = await saveDownloadAsInvoiceDocument(download, page.url());
        const withDownload = await snapshotFromPage(page, kind, [document]);
        if (withDownload) snapshots.push(withDownload);
        continue;
      }

      if (popup) {
        await popup.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined);
        await popup.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
        const docs = await downloadInvoiceDocuments(popup);
        const popupSnapshot = await snapshotFromPage(popup, kind, docs);
        if (popupSnapshot) snapshots.push(popupSnapshot);
        await popup.close().catch(() => undefined);
        continue;
      }

      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
      const docs = await downloadInvoiceDocuments(page);
      const detailSnapshot = await snapshotFromPage(page, kind, docs);
      if (detailSnapshot) snapshots.push(detailSnapshot);

      if (page.url() !== beforeUrl) {
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => page.goto(beforeUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined));
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
        await markCandidates(page, "detail", maxCandidates);
      }
    } catch {
      if (page.url() !== beforeUrl) {
        await page.goto(beforeUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
        await markCandidates(page, "detail", maxCandidates).catch(() => undefined);
      }
    }
  }

  return snapshots;
}

async function downloadInvoiceDocuments(page) {
  const documents = [];
  const candidateCount = await markCandidates(page, "invoice", Math.min(maxCandidates, 8));
  const startingUrl = page.url();

  for (let index = 0; index < candidateCount; index += 1) {
    const selector = `[data-alibaba-agent-invoice="${index}"]`;
    const locator = page.locator(selector).first();
    try {
      const downloadPromise = page.waitForEvent("download", { timeout: 8_000 }).catch(() => null);
      await locator.click({ timeout: 10_000 });
      const download = await downloadPromise;

      if (download) {
        documents.push(await saveDownloadAsInvoiceDocument(download, page.url()));
        continue;
      }

      await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
      if (page.url() !== startingUrl) {
        const bodyText = await getBodyText(page);
        if (/invoice|receipt|order|total|amount|supplier/i.test(bodyText)) {
          documents.push({
            fileName: `${sanitizeFileName(await page.title().catch(() => "alibaba-invoice"))}.html`,
            sourceUrl: page.url(),
            text: bodyText,
            downloadedAt: new Date().toISOString()
          });
        }
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => page.goto(startingUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined));
        await markCandidates(page, "invoice", Math.min(maxCandidates, 8)).catch(() => undefined);
      }
    } catch {
      if (page.url() !== startingUrl) {
        await page.goto(startingUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      }
    }
  }

  return uniqueInvoiceDocuments(documents);
}

async function snapshotFromPage(page, kind, invoiceDocuments = []) {
  const text = await getBodyText(page);
  if (!looksRelevant(text)) return null;
  const sourceUrl = page.url();
  const pageTitle = await page.title().catch(() => "Alibaba portal");
  const orderId = extractOrderId(`${sourceUrl}\n${text}`);
  const supplierName = extractSupplierName(text);

  return {
    sourceUrl,
    pageTitle,
    capturedAt: new Date().toISOString(),
    subject: kind === "messages" ? "Alibaba portal message" : "Alibaba portal order detail",
    messageId: `<alibaba-portal:${orderId ?? hashText(sourceUrl).slice(0, 16)}>`,
    orderId,
    supplierName,
    text,
    invoiceDocuments
  };
}

async function markCandidates(page, mode, limit) {
  return page.evaluate(({ mode, limit }) => {
    const include = mode === "invoice"
      ? /(invoice|receipt|download\s+invoice|commercial\s+invoice|pdf)/i
      : /(view\s+order|order\s+detail|details|message|invoice|receipt|payment|paid|shipment|shipping|trade\s+assurance)/i;
    const exclude = /(pay\s+now|place\s+order|buy\s+now|add\s+to\s+cart|cancel\s+order|delete|remove|refund|dispute|sign\s*out|log\s*out)/i;
    const attr = mode === "invoice" ? "data-alibaba-agent-invoice" : "data-alibaba-agent-detail";
    document.querySelectorAll(`[${attr}]`).forEach((element) => element.removeAttribute(attr));
    let count = 0;

    for (const element of Array.from(document.querySelectorAll("a, button, [role='button']"))) {
      const text = [
        element.innerText,
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("href")
      ].filter(Boolean).join(" ");

      if (!include.test(text) || exclude.test(text)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      element.setAttribute(attr, String(count));
      count += 1;
      if (count >= limit) break;
    }

    return count;
  }, { mode, limit });
}

async function saveDownloadAsInvoiceDocument(download, sourceUrl) {
  const suggested = sanitizeFileName(download.suggestedFilename() || "alibaba-invoice.pdf");
  const filePath = uniqueFilePath(path.join(downloadsDir, suggested));
  await download.saveAs(filePath);
  const buffer = fs.readFileSync(filePath);
  return {
    fileName: path.basename(filePath),
    localPath: relativeProjectPath(filePath),
    sourceUrl: download.url() || sourceUrl,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    text: await extractDocumentText(filePath),
    downloadedAt: new Date().toISOString()
  };
}

async function uploadSnapshots(snapshots) {
  const headers = { "content-type": "application/json" };
  if (secret) headers.authorization = `Bearer ${secret}`;

  let response;
  try {
    response = await fetch(`${baseUrl}/api/integrations/alibaba-portal/import`, {
      method: "POST",
      headers,
      body: JSON.stringify({ snapshots, autoApply: true, autoCreateInvoices: true, actorId: "alibaba-portal-agent" })
    });
  } catch (error) {
    throw new Error(`could not reach inventory app at ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const body = await response.json().catch(() => ({ errors: [`HTTP ${response.status} ${response.statusText}`] }));
  if (!response.ok && response.status !== 207) {
    const detail = Array.isArray(body.errors) ? body.errors.join("; ") : body.error ?? response.statusText;
    throw new Error(`portal import endpoint returned HTTP ${response.status}: ${detail}`);
  }
  return body;
}

async function extractDocumentText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if ([".txt", ".html", ".htm", ".csv"].includes(ext)) {
    return fs.readFileSync(filePath, "utf8").slice(0, 250_000);
  }

  if (ext !== ".pdf") return undefined;

  try {
    const buffer = fs.readFileSync(filePath);
    const pdfParseModule = await import("pdf-parse");
    if (typeof pdfParseModule.default === "function") {
      const parsed = await pdfParseModule.default(buffer);
      return parsed?.text?.slice(0, 250_000);
    }
    if (typeof pdfParseModule.PDFParse === "function") {
      const parser = new pdfParseModule.PDFParse({ data: buffer });
      const parsed = await parser.getText();
      await parser.destroy?.();
      return (parsed?.text ?? parsed?.pages?.map((page) => page.text).join("\n") ?? "").slice(0, 250_000);
    }
  } catch (error) {
    if (verbose) console.error(`Could not extract PDF text from ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  return undefined;
}

async function importPlaywright() {
  try {
    return await import("playwright-core");
  } catch {
    throw new Error("playwright-core is not installed. Run `npm install` in the Lambenti inventory app.");
  }
}

function findChromeExecutable() {
  const configured = process.env.LAMBENTI_ALIBABA_BROWSER_EXECUTABLE_PATH;
  if (configured) {
    if (!fs.existsSync(configured)) {
      throw new Error(`LAMBENTI_ALIBABA_BROWSER_EXECUTABLE_PATH does not exist: ${configured}`);
    }
    if (!looksLikeGoogleChromePath(configured)) {
      throw new Error("LAMBENTI_ALIBABA_BROWSER_EXECUTABLE_PATH must point to Google Chrome, not Edge/Chromium. Use C:/Program Files/Google/Chrome/Application/chrome.exe on Windows.");
    }
    return configured;
  }

  const candidates = process.platform === "win32"
    ? [
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"
      ]
    : [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function ensureAlibabaAuthenticated(page) {
  let state = await getAlibabaAuthState(page);
  if (state.securityChallengeRequired || !state.loginRequired || !autoSubmitSavedLogin) {
    return { ...state, autoLoginAttempted: false };
  }

  let autoLoginAttempted = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const submitted = await submitAutofilledLoginStep(page);
    if (!submitted) break;
    autoLoginAttempted = true;
    await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(loginSettleMs);
    state = await getAlibabaAuthState(page);
    if (state.securityChallengeRequired || !state.loginRequired) break;
  }

  return { ...state, autoLoginAttempted };
}

async function getAlibabaAuthState(page) {
  const url = page.url();
  const text = await getBodyText(page);
  return detectAlibabaAuthState({ url, text });
}

async function submitAutofilledLoginStep(page) {
  for (const frame of page.frames()) {
    const result = await frame.evaluate(() => {
      const visible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const hasValue = (input) => typeof input.value === "string" && input.value.trim().length > 0;
      const passwordInputs = Array.from(document.querySelectorAll("input[type='password']")).filter(visible);
      const filledPassword = passwordInputs.find(hasValue);
      const identityInputs = Array.from(document.querySelectorAll("input[type='email'], input[type='text'], input[name*='email' i], input[name*='account' i], input[name*='login' i], input[name*='user' i]")).filter(visible);
      const filledIdentity = identityInputs.find(hasValue);
      const anchorInput = filledPassword ?? filledIdentity;
      if (!anchorInput) return { attempted: false };

      const form = anchorInput.closest("form");
      const root = form ?? document;
      const controls = Array.from(root.querySelectorAll("button, input[type='submit'], [role='button']")).filter(visible);
      const submit = controls.find((element) => {
        if (element instanceof HTMLInputElement || element instanceof HTMLButtonElement) {
          if (element.disabled) return false;
        }
        const label = [element.textContent, element.getAttribute("aria-label"), element.getAttribute("title"), element.getAttribute("value")].filter(Boolean).join(" ");
        return /sign\s*in|log\s*in|submit|continue|next|登录|登入|下一步/i.test(label);
      }) ?? controls.find((element) => !(element instanceof HTMLInputElement || element instanceof HTMLButtonElement) || !element.disabled);

      if (submit) {
        submit.click();
        return { attempted: true };
      }

      if (form instanceof HTMLFormElement) {
        form.requestSubmit?.();
        return { attempted: true };
      }

      return { attempted: false };
    }).catch(() => ({ attempted: false }));

    if (result.attempted) return true;
  }

  return false;
}

async function getBodyText(page) {
  return page.locator("body").innerText({ timeout: 15_000 }).catch(() => "");
}

function looksRelevant(text) {
  return /alibaba|trade assurance|order|invoice|supplier|quantity|total|paid|payment|shipping|shipment/i.test(text)
    && /order|invoice|payment|supplier|quantity|total/i.test(text);
}

function extractOrderId(text) {
  const match = text.match(/(?:order\s*(?:id|no\.?|number|#)|orderId[=:/]|trade\s+assurance\s+order)\s*[:.#=-]?\s*([A-Z0-9][A-Z0-9-]*\d[A-Z0-9-]*)/i)
    ?? text.match(/\b([0-9]{10,})\b/);
  return match?.[1];
}

function extractSupplierName(text) {
  const match = text.match(/(?:supplier|seller|store|company)\s*[:#-]?\s*([^\n|;]{2,80})/i)
    ?? text.match(/supplier\s+(.+?)\s+has received/i);
  return match?.[1]?.replace(/\s{2,}/g, " ").trim();
}

function uniqueBySnapshotIdentity(snapshots) {
  const seen = new Set();
  const unique = [];
  for (const snapshot of snapshots) {
    const key = snapshot.orderId ?? `${snapshot.sourceUrl}:${hashText(snapshot.text).slice(0, 20)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(snapshot);
  }
  return unique;
}

function uniqueInvoiceDocuments(documents) {
  const seen = new Set();
  return documents.filter((document) => {
    const key = document.sha256 ?? `${document.sourceUrl}:${hashText(document.text ?? "")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueFilePath(filePath) {
  if (!fs.existsSync(filePath)) return filePath;
  const ext = path.extname(filePath);
  const base = filePath.slice(0, -ext.length);
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base}-${index}${ext}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not allocate unique file path for ${filePath}`);
}

function sanitizeFileName(value) {
  const cleaned = value.replace(/[<>:"/\\|?*\x00-\x1F]+/g, "-").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 160) || "alibaba-invoice";
}

function relativeProjectPath(filePath) {
  return path.relative(projectRoot, filePath).replace(/\\/g, "/");
}

function hashText(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function emptyResult(overrides = {}) {
  return {
    configured: true,
    loginRequired: false,
    securityChallengeRequired: false,
    autoLoginAttempted: false,
    capturedSnapshots: 0,
    imported: 0,
    duplicates: 0,
    appliedOrAlreadyApplied: 0,
    invoicesCreatedOrUpdated: 0,
    needsReview: 0,
    errors: [],
    ...overrides
  };
}

function formatResult(result) {
  if (result.setupComplete) return result.message;

  const lines = [];
  if (result.securityChallengeRequired) {
    lines.push("Alibaba portal agent hit a manual security/CAPTCHA/verification check.");
    lines.push("I cannot bypass Alibaba CAPTCHA/security checks; complete them manually in Chrome, then scheduled runs can continue using the saved Chrome session.");
    lines.push(...result.errors);
    return lines.join("\n");
  }

  if (result.loginRequired) {
    lines.push(result.autoLoginAttempted
      ? "Alibaba portal agent tried Chrome's saved/autofilled login info, but Alibaba still requires manual login."
      : "Alibaba portal agent needs a Chrome browser login session.");
    lines.push(...result.errors);
    return lines.join("\n");
  }

  lines.push(`Alibaba portal agent captured ${result.capturedSnapshots} portal snapshot${result.capturedSnapshots === 1 ? "" : "s"}.`);
  if (result.autoLoginAttempted) lines.push("Chrome saved/autofilled login info was submitted successfully before capture.");
  lines.push(`Imported ${result.imported}, duplicates ${result.duplicates}, applied/already applied ${result.appliedOrAlreadyApplied}, invoices created/updated ${result.invoicesCreatedOrUpdated}, needs review ${result.needsReview}.`);
  if (result.reviewUrl) lines.push(`Review orders: ${result.reviewUrl}`);
  if (result.invoicesUrl) lines.push(`Review invoices: ${result.invoicesUrl}`);
  if (result.errors.length > 0) lines.push(`Warnings: ${result.errors.join("; ")}`);
  lines.push("No physical stock was received; receiving remains a separate human-approved inventory action.");
  return lines.join("\n");
}

function shouldEmitLoginReminder() {
  const state = readState();
  if (state.loginReminderShown) return false;
  writeState({ ...state, loginReminderShown: true, loginReminderShownAt: new Date().toISOString() });
  return true;
}

function shouldEmitChallengeReminder() {
  const state = readState();
  if (state.challengeReminderShown) return false;
  writeState({ ...state, challengeReminderShown: true, challengeReminderShownAt: new Date().toISOString() });
  return true;
}

function clearManualInterventionReminders() {
  const state = readState();
  writeState({
    ...state,
    loginReminderShown: false,
    challengeReminderShown: false,
    loginReminderClearedAt: new Date().toISOString(),
    challengeReminderClearedAt: new Date().toISOString()
  });
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

async function waitForEnter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    await rl.question("Press Enter after Alibaba login is complete...");
  } finally {
    rl.close();
  }
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
