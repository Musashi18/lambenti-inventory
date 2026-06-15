#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { detectAlibabaAuthState, looksLikeGoogleChromePath, selectChromeProfileFromLocalState } from "./alibaba-portal-auth.mjs";
import {
  browserLaunchFailedBecauseDefaultProfileRemoteDebugging,
  browserLaunchFailedBecauseProfileOpen,
  buildManualChromeOpenArgs,
  normalizePortalUrl
} from "./alibaba-portal-browser.mjs";
import {
  buildAlibabaAccountConfirmRegexSource,
  buildSavedGoogleContinueRegexSource,
  clickWindowsAlibabaAccountConfirm,
  clickWindowsUiButtonByRegex,
  matchesAlibabaAccountConfirmationText,
  matchesSavedGoogleContinueButtonName,
  normalizeContinueAsNames,
  normalizeTrustedAlibabaAccountEmails
} from "./alibaba-portal-login-assist.mjs";
import {
  ALIBABA_PORTAL_CANDIDATE_PATTERN_SOURCES,
  buildPortalMessageId,
  extractConversationContext,
  extractOrderId as extractOrderIdCore,
  extractOrderStatus as extractOrderStatusCore,
  extractPortalEvidenceDate,
  extractSupplierName as extractSupplierNameCore,
  extractTrackingNumbers as extractTrackingNumbersCore,
  hasShippingTrackingMessageContext,
  isRecentPortalEvidence,
  looksRelevant as looksRelevantCore
} from "./alibaba-portal-extraction.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const envPath = path.join(projectRoot, ".env");

loadDotEnv(envPath);

const args = new Set(process.argv.slice(2));
const portalImportOptions = resolvePortalImportOptions(process.argv.slice(2));
const trackingOnly = portalImportOptions.trackingOnly;
const verbose = args.has("--verbose") || args.has("-v");
const jsonOnly = args.has("--json");
const dryRun = args.has("--dry-run");
const setupLogin = args.has("--setup-login") || args.has("--login");
const profileInfo = args.has("--profile-info");
const headless = args.has("--headless") || /^true$/i.test(process.env.LAMBENTI_ALIBABA_HEADLESS ?? "");
const autoSubmitSavedLogin = !args.has("--no-auto-submit-saved-login") && !/^false$/i.test(process.env.LAMBENTI_ALIBABA_AUTO_SUBMIT_SAVED_LOGIN ?? "true");
const loginAssistEnabled = !args.has("--no-login-assist") && !/^false$/i.test(process.env.LAMBENTI_ALIBABA_LOGIN_ASSIST ?? "true");
const promptCredentials = setupLogin && !args.has("--no-prompt-credentials") && !/^false$/i.test(process.env.LAMBENTI_ALIBABA_PROMPT_CREDENTIALS ?? "true");
const authSettleMs = positiveInt(process.env.LAMBENTI_ALIBABA_AUTH_SETTLE_MS, 2_000);
const browserStartupSettleMs = positiveInt(process.env.LAMBENTI_ALIBABA_BROWSER_STARTUP_SETTLE_MS, 2_000);
const loginSettleMs = positiveInt(process.env.LAMBENTI_ALIBABA_LOGIN_SETTLE_MS, 5_000);
const googleContinueTimeoutMs = positiveInt(process.env.LAMBENTI_ALIBABA_GOOGLE_CONTINUE_TIMEOUT_MS, 12_000);
const accountConfirmTimeoutMs = positiveInt(process.env.LAMBENTI_ALIBABA_ACCOUNT_CONFIRM_TIMEOUT_MS, 8_000);
const trackingRecentMonths = positiveInt(readOptionValue("--recent-months") ?? process.env.LAMBENTI_ALIBABA_TRACKING_RECENT_MONTHS, 3);
const trackingScrapeNow = new Date();
const maxCandidates = positiveInt(process.env.LAMBENTI_ALIBABA_MAX_LINKS, trackingOnly ? 4 : 12);
const maxCompletedReviewCandidates = positiveInt(
  process.env.LAMBENTI_ALIBABA_MAX_COMPLETED_REVIEW_LINKS,
  trackingOnly ? Math.max(maxCandidates, 24) : maxCandidates
);
const maxTrackingClickLayers = positiveInt(process.env.LAMBENTI_ALIBABA_MAX_TRACKING_CLICK_LAYERS, trackingOnly ? 4 : 2);
const maxTrackingButtonsPerLayer = positiveInt(process.env.LAMBENTI_ALIBABA_MAX_TRACKING_BUTTONS_PER_LAYER, trackingOnly ? 6 : 3);
const baseUrl = (process.env.LAMBENTI_INVENTORY_BASE_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const secret = process.env.LAMBENTI_ALIBABA_AGENT_SECRET ?? process.env.LAMBENTI_EMAIL_SYNC_SECRET;
const DEFAULT_ALIBABA_ORDERS_URL = "https://biz.alibaba.com/order/list.htm";
const DEFAULT_ALIBABA_MESSAGES_URL = "https://message.alibaba.com/message/messenger.htm";
const startUrl = normalizePortalUrl(process.env.LAMBENTI_ALIBABA_ORDERS_URL, DEFAULT_ALIBABA_ORDERS_URL);
const messagesUrl = normalizePortalUrl(process.env.LAMBENTI_ALIBABA_MESSAGES_URL, DEFAULT_ALIBABA_MESSAGES_URL);
const maxMessageThreads = positiveInt(process.env.LAMBENTI_ALIBABA_MAX_MESSAGE_THREADS, trackingOnly ? 12 : 20);
const maxMessageListScrolls = positiveInt(process.env.LAMBENTI_ALIBABA_MESSAGE_LIST_SCROLLS, trackingOnly ? 4 : 4);
const orderStatusSettleMs = positiveInt(process.env.LAMBENTI_ALIBABA_ORDER_STATUS_SETTLE_MS, trackingOnly ? 350 : 700);
const orderDetailNetworkIdleTimeoutMs = positiveInt(process.env.LAMBENTI_ALIBABA_ORDER_DETAIL_NETWORK_IDLE_MS, trackingOnly ? 3_000 : 8_000);
const messageThreadNetworkIdleTimeoutMs = positiveInt(process.env.LAMBENTI_ALIBABA_MESSAGE_THREAD_NETWORK_IDLE_MS, trackingOnly ? 2_000 : 5_000);
const messageThreadSettleMs = positiveInt(process.env.LAMBENTI_ALIBABA_MESSAGE_THREAD_SETTLE_MS, trackingOnly ? 250 : 700);
const portalScrollContainerLimit = positiveInt(process.env.LAMBENTI_ALIBABA_PORTAL_SCROLL_CONTAINERS, trackingOnly ? 4 : 12);
const portalScrollSteps = positiveInt(process.env.LAMBENTI_ALIBABA_PORTAL_SCROLL_STEPS, trackingOnly ? 3 : 8);
const portalScrollPauseMs = positiveInt(process.env.LAMBENTI_ALIBABA_PORTAL_SCROLL_PAUSE_MS, trackingOnly ? 80 : 200);
const browserProfile = resolveBrowserProfile();
const userDataDir = browserProfile.userDataDir;
const downloadsDir = path.resolve(projectRoot, process.env.LAMBENTI_ALIBABA_INVOICE_DIR ?? "var/alibaba-invoices");
const statePath = path.resolve(projectRoot, "var/alibaba-portal-agent-state.json");

export function resolvePortalImportOptions(argv = process.argv.slice(2)) {
  const optionSet = new Set(argv);
  const trackingOnly = optionSet.has("--tracking-only");
  return {
    trackingOnly,
    autoApply: !(trackingOnly || optionSet.has("--no-auto-apply")),
    autoCreateInvoices: !(trackingOnly || optionSet.has("--no-auto-create-invoices") || optionSet.has("--no-auto-create-invoice"))
  };
}

export function buildPortalImportPayload(snapshots, options = portalImportOptions) {
  return {
    snapshots,
    autoApply: options.autoApply,
    autoCreateInvoices: options.autoCreateInvoices,
    actorId: options.trackingOnly ? "alibaba-tracking-capture-agent" : "alibaba-portal-agent"
  };
}

export function buildPortalCaptureTargets(options = portalImportOptions, urls = { ordersUrl: startUrl, messagesUrl }) {
  if (options.trackingOnly) {
    return [
      { url: urls.ordersUrl, kind: "orders", orderStatus: "delivering", label: "orders-delivering" },
      { url: urls.ordersUrl, kind: "orders", orderStatus: "completed-review", label: "orders-completed-review" },
      { url: urls.messagesUrl, kind: "messages", label: "messages" }
    ];
  }

  return [
    { url: urls.ordersUrl, kind: "orders", label: "orders" },
    { url: urls.messagesUrl, kind: "messages", label: "messages" }
  ];
}

const TRACKING_CAPTURE_MEMORY_VERSION = 1;
const TRACKING_CAPTURE_MEMORY_MAX_ENTRIES = 600;

export function createEmptyTrackingCaptureMemory(now = new Date().toISOString()) {
  return {
    version: TRACKING_CAPTURE_MEMORY_VERSION,
    createdAt: now,
    updatedAt: now,
    runs: 0,
    orders: {},
    messages: {}
  };
}

export function isWaitingForSupplierToShipText(text) {
  return /(?:waiting\s+for\s+(?:the\s+)?supplier\s+to\s+ship|awaiting\s+supplier\s+ship(?:ment)?|supplier\s+has\s+not\s+shipped|to\s+be\s+shipped\s+by\s+supplier|待发货|等待供应商发货)/i.test(normalizeMemoryText(text));
}

export function isGenericLogisticsServicesCandidateText(text) {
  const normalized = normalizeMemoryText(text);
  if (!normalized) return false;
  if (/(?:buyer_market_list|logistics\.alibaba\.com\/buyer\/luyou\/blg)/i.test(normalized)) return true;
  return /\b(?:alibaba(?:\.com)?\s*)?logistics\s+services?\b/i.test(normalized)
    && !/(?:track\s+(?:package|shipment|order)|tracking\s+details?|shipment\s+details?|shipping\s+details?|waybill|order\s*(?:id|no\.?|number|#)|[?&](?:orderId|order_id|orderNumber|order_number)=\d{10,24})/i.test(normalized);
}

export function buildTrackingOrderCandidateText(candidate = {}) {
  return [
    candidate.href,
    candidate.sourceUrl,
    candidate.orderId ? `Order ID: ${candidate.orderId}` : undefined,
    candidate.label,
    candidate.text,
    candidate.containerText,
    candidate.contextText
  ].filter(Boolean).join("\n");
}

export function buildTrackingOrderCandidateFingerprint(candidate = {}) {
  return hashText(normalizeMemoryText(candidate.fingerprintSeed ?? buildTrackingOrderCandidateText(candidate))).slice(0, 32);
}

export function buildTrackingOrderMemoryKey(candidate = {}) {
  const orderId = extractOrderIdForMemory(candidate);
  if (orderId) return `order:${orderId}`;
  const seed = normalizeMemoryText(buildTrackingOrderCandidateText(candidate)).slice(0, 2_000);
  return `order-candidate:${hashText(seed || "unknown-order-candidate").slice(0, 20)}`;
}

export function shouldSkipTrackingOrderCandidate(candidate = {}, memory = createEmptyTrackingCaptureMemory()) {
  const candidateText = buildTrackingOrderCandidateText(candidate);
  if (isWaitingForSupplierToShipText(candidateText)) {
    return { skip: true, reason: "waiting-supplier-to-ship", key: buildTrackingOrderMemoryKey(candidate) };
  }
  if (isGenericLogisticsServicesCandidateText(candidateText)) {
    return { skip: true, reason: "generic-logistics-services", key: buildTrackingOrderMemoryKey(candidate) };
  }

  const key = candidate.key || buildTrackingOrderMemoryKey(candidate);
  const orderId = extractOrderIdForMemory(candidate);
  const orderKey = orderId ? `order:${orderId}` : undefined;
  const orders = normalizeTrackingCaptureMemory(memory).orders;
  const entry = orders[key] ?? (orderKey ? orders[orderKey] : undefined);
  if (entry?.trackingNumbers?.length > 0) {
    return { skip: true, reason: "tracking-already-captured", key: entry.key ?? key };
  }

  const candidateFingerprint = candidate.fingerprint || buildTrackingOrderCandidateFingerprint(candidate);
  if (entry?.lastFingerprint && candidateFingerprint && entry.lastFingerprint === candidateFingerprint) {
    return { skip: true, reason: "already-checked-unchanged", key: entry.key ?? key };
  }

  return { skip: false, reason: "unread-or-changed", key };
}

export function buildMessageThreadMemoryKey(candidate = {}) {
  const seed = buildMessageThreadStableSeed(candidate);
  return `message-thread:${hashText(seed || "unknown-message-thread").slice(0, 20)}`;
}

export function shouldReadMessageThread(candidate = {}, memory = createEmptyTrackingCaptureMemory()) {
  const key = candidate.key || buildMessageThreadMemoryKey(candidate);
  const listFingerprint = candidate.listFingerprint || buildMessageThreadListFingerprint(candidate);
  const entry = normalizeTrackingCaptureMemory(memory).messages[key];
  if (entry?.lastListFingerprint && entry.lastListFingerprint === listFingerprint) {
    return { read: false, reason: "already-read-no-new-messages", key, listFingerprint };
  }
  return { read: true, reason: entry ? "new-message-fingerprint" : "unread-thread", key, listFingerprint };
}

export function recordTrackingOrderRead(memory, input = {}) {
  const normalizedMemory = normalizeTrackingCaptureMemory(memory);
  const key = input.key || buildTrackingOrderMemoryKey(input);
  const now = new Date().toISOString();
  const orderId = extractOrderIdFromMemoryKey(key) || input.orderId || extractOrderIdForMemory(input);
  const candidateText = buildTrackingOrderCandidateText(input);
  const trackingNumbers = uniqueTrackingNumbers(input.trackingNumbers ?? extractTrackingNumbers(candidateText));
  const previous = normalizedMemory.orders[key] ?? {};
  normalizedMemory.orders[key] = {
    ...previous,
    key,
    orderId: orderId ?? previous.orderId,
    label: truncateForMemory(input.label ?? previous.label ?? input.text ?? input.containerText ?? "", 240),
    source: input.source ?? previous.source,
    status: input.status ?? previous.status,
    firstSeenAt: previous.firstSeenAt ?? now,
    lastSeenAt: now,
    lastReadAt: now,
    lastFingerprint: input.fingerprint ?? buildTrackingOrderCandidateFingerprint(input) ?? previous.lastFingerprint,
    trackingNumbers: uniqueTrackingNumbers([...(previous.trackingNumbers ?? []), ...trackingNumbers]),
    lastTrackingFoundAt: trackingNumbers.length > 0 ? now : previous.lastTrackingFoundAt
  };
  normalizedMemory.updatedAt = now;
  trimTrackingCaptureMemory(normalizedMemory);
  return normalizedMemory.orders[key];
}

export function recordMessageThreadRead(memory, input = {}) {
  const normalizedMemory = normalizeTrackingCaptureMemory(memory);
  const key = input.key || buildMessageThreadMemoryKey(input);
  const now = new Date().toISOString();
  const listFingerprint = input.listFingerprint || buildMessageThreadListFingerprint(input);
  const sectionFingerprint = input.sectionFingerprint || hashText(normalizeMemoryText(input.sectionText ?? "")).slice(0, 32);
  const trackingNumbers = uniqueTrackingNumbers(input.trackingNumbers ?? extractTrackingNumbers(input.sectionText ?? ""));
  const previous = normalizedMemory.messages[key] ?? {};
  normalizedMemory.messages[key] = {
    ...previous,
    key,
    label: truncateForMemory(input.label ?? previous.label ?? "", 240),
    firstSeenAt: previous.firstSeenAt ?? now,
    lastSeenAt: now,
    lastReadAt: now,
    lastListFingerprint: listFingerprint,
    lastSectionFingerprint: sectionFingerprint,
    readCount: (previous.readCount ?? 0) + 1,
    hasShippingTrackingContext: Boolean(input.hasShippingTrackingContext ?? previous.hasShippingTrackingContext ?? trackingNumbers.length > 0),
    trackingNumbers: uniqueTrackingNumbers([...(previous.trackingNumbers ?? []), ...trackingNumbers]),
    lastTrackingFoundAt: trackingNumbers.length > 0 ? now : previous.lastTrackingFoundAt
  };
  normalizedMemory.updatedAt = now;
  trimTrackingCaptureMemory(normalizedMemory);
  return normalizedMemory.messages[key];
}

export function seedTrackingCaptureMemoryFromSavedTrackingRows(memory, rows = []) {
  const normalizedMemory = normalizeTrackingCaptureMemory(memory);
  const seededOrderKeys = new Set();
  let savedTrackingRowsHydrated = 0;

  for (const row of rows) {
    const trackingNumber = uniqueTrackingNumbers([row?.trackingNumber])[0];
    if (!trackingNumber) continue;
    const orderId = extractOrderIdFromSavedTrackingRow(row);
    if (!orderId) continue;
    const key = `order:${orderId}`;
    const previous = normalizedMemory.orders[key];

    recordTrackingOrderRead(normalizedMemory, {
      key,
      orderId,
      label: `Saved tracking ${trackingNumber} for order ${orderId}`,
      text: [
        `Order ID: ${orderId}`,
        `Tracking Number: ${trackingNumber}`,
        row?.sourceUrl,
        row?.emailOrderImport?.sourceUrl,
        row?.emailOrderImport?.subject
      ].filter(Boolean).join("\n"),
      trackingNumbers: [trackingNumber],
      source: row?.source ?? "saved-tracking-db",
      status: row?.currentStatus ?? row?.refreshStatus ?? previous?.status
    });

    savedTrackingRowsHydrated += 1;
    seededOrderKeys.add(key);
  }

  return {
    savedTrackingRowsHydrated,
    savedTrackingOrdersHydrated: seededOrderKeys.size
  };
}

function normalizeTrackingCaptureMemory(value) {
  if (!value || typeof value !== "object") return createEmptyTrackingCaptureMemory();
  value.version = TRACKING_CAPTURE_MEMORY_VERSION;
  value.createdAt = value.createdAt || new Date().toISOString();
  value.updatedAt = value.updatedAt || value.createdAt;
  value.runs = Number.isFinite(value.runs) ? value.runs : 0;
  if (!value.orders || typeof value.orders !== "object" || Array.isArray(value.orders)) value.orders = {};
  if (!value.messages || typeof value.messages !== "object" || Array.isArray(value.messages)) value.messages = {};
  for (const [key, entry] of Object.entries(value.orders)) {
    if (!entry || typeof entry !== "object") continue;
    const keyOrderId = extractOrderIdFromMemoryKey(key);
    if (keyOrderId) entry.orderId = keyOrderId;
  }
  return value;
}

function buildTrackingCaptureMemoryHints(memory) {
  const normalizedMemory = normalizeTrackingCaptureMemory(memory);
  const readOrders = {};
  for (const [key, entry] of Object.entries(normalizedMemory.orders)) {
    if (!entry) continue;
    const aliases = [key, entry.orderId ? `order:${entry.orderId}` : null].filter(Boolean);
    for (const alias of aliases) {
      readOrders[alias] = {
        lastFingerprint: entry.lastFingerprint,
        hasTracking: Array.isArray(entry.trackingNumbers) && entry.trackingNumbers.length > 0
      };
    }
  }
  const skipOrderKeys = Object.entries(readOrders)
    .filter(([, entry]) => entry.hasTracking)
    .map(([key]) => key);
  const readMessages = Object.fromEntries(Object.entries(normalizedMemory.messages)
    .filter(([, entry]) => entry?.lastListFingerprint)
    .map(([key, entry]) => [key, entry.lastListFingerprint]));
  return { skipOrderKeys: [...new Set(skipOrderKeys)], readOrders, readMessages };
}

function startTrackingCaptureMemoryRun(memory) {
  const normalizedMemory = normalizeTrackingCaptureMemory(memory);
  const now = new Date().toISOString();
  normalizedMemory.runs = (normalizedMemory.runs ?? 0) + 1;
  normalizedMemory.lastRunStartedAt = now;
  normalizedMemory.updatedAt = now;
  return normalizedMemory;
}

function finishTrackingCaptureMemoryRun(memory, stats = {}) {
  const normalizedMemory = normalizeTrackingCaptureMemory(memory);
  const now = new Date().toISOString();
  normalizedMemory.lastRunFinishedAt = now;
  normalizedMemory.lastRunStats = { ...stats, finishedAt: now };
  normalizedMemory.updatedAt = now;
  trimTrackingCaptureMemory(normalizedMemory);
  return normalizedMemory;
}

function createTrackingCaptureMemoryStats() {
  return {
    savedTrackingRowsHydrated: 0,
    savedTrackingOrdersHydrated: 0,
    orderCandidatesSkippedKnownTracking: 0,
    orderCandidatesSkippedGenericLogistics: 0,
    orderCandidatesSkippedWaitingToShip: 0,
    orderCandidatesSkippedAlreadyChecked: 0,
    orderCandidatesRead: 0,
    orderReadsRemembered: 0,
    messageThreadsSkippedStale: 0,
    messageThreadsRead: 0,
    messageThreadsRemembered: 0
  };
}

function trackingCaptureMemorySummary(memory, stats = {}) {
  const normalizedMemory = normalizeTrackingCaptureMemory(memory);
  return {
    path: relativeProjectPath(statePath),
    ...stats,
    ordersRemembered: Object.keys(normalizedMemory.orders).length,
    messageThreadsRemembered: Object.keys(normalizedMemory.messages).length
  };
}

async function hydrateTrackingCaptureMemoryFromSavedTrackingRows(memory, stats = null) {
  if (!memory) return { savedTrackingRowsHydrated: 0, savedTrackingOrdersHydrated: 0 };
  let prisma;
  try {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    const rows = await prisma.trackingNumber.findMany({
      orderBy: { updatedAt: "desc" },
      take: positiveInt(process.env.LAMBENTI_ALIBABA_TRACKING_MEMORY_DB_ROWS, 500),
      select: {
        trackingNumber: true,
        source: true,
        sourceUrl: true,
        externalOrderId: true,
        currentStatus: true,
        refreshStatus: true,
        emailOrderImport: {
          select: {
            externalOrderId: true,
            sourceUrl: true,
            subject: true
          }
        }
      }
    });
    const result = seedTrackingCaptureMemoryFromSavedTrackingRows(memory, rows);
    if (stats) {
      stats.savedTrackingRowsHydrated += result.savedTrackingRowsHydrated;
      stats.savedTrackingOrdersHydrated += result.savedTrackingOrdersHydrated;
    }
    if (result.savedTrackingRowsHydrated > 0) writeTrackingCaptureMemory(memory);
    return result;
  } catch (error) {
    if (verbose) console.error(`Could not hydrate Alibaba tracking memory from saved tracking rows: ${error instanceof Error ? error.message : String(error)}`);
    return { savedTrackingRowsHydrated: 0, savedTrackingOrdersHydrated: 0 };
  } finally {
    await prisma?.$disconnect?.().catch(() => undefined);
  }
}

function extractOrderIdForMemory(candidate = {}) {
  return candidate.orderId || extractOrderId(buildTrackingOrderCandidateText(candidate));
}

function extractOrderIdFromSavedTrackingRow(row = {}) {
  const candidates = [
    row.externalOrderId,
    row.emailOrderImport?.externalOrderId,
    row.sourceUrl,
    row.emailOrderImport?.sourceUrl,
    row.emailOrderImport?.subject
  ];
  for (const candidate of candidates) {
    const text = String(candidate ?? "");
    const orderId = extractOrderId(text);
    if (orderId) return orderId;
    const numeric = text.match(/\b([0-9]{10,24})\b/);
    if (numeric?.[1]) return numeric[1];
  }
  return undefined;
}

function extractOrderIdFromMemoryKey(key) {
  const match = String(key ?? "").match(/^order:([0-9]{10,24})$/);
  return match?.[1];
}

function buildMessageThreadStableSeed(candidate = {}) {
  if (candidate.threadId) return `thread:${normalizeMemoryText(candidate.threadId)}`;
  if (candidate.href) {
    try {
      const url = new URL(candidate.href, "https://message.alibaba.com");
      for (const name of ["conversationId", "conversation_id", "threadId", "thread_id", "cid", "id", "uid"]) {
        const value = url.searchParams.get(name);
        if (value) return `${name}:${value}`;
      }
      const pathSeed = `${url.hostname}${url.pathname}`.replace(/\/+$/, "");
      if (pathSeed && !/\/message\/messenger\.htm$/i.test(url.pathname)) return pathSeed;
    } catch {
      // Fall through to text-derived key.
    }
  }
  const raw = String(candidate.label ?? candidate.text ?? "").split(/\r?\n/).map((line) => normalizeMemoryText(line)).find(Boolean) ?? "";
  return raw
    .replace(/\b(?:today|yesterday|mon|tue|wed|thu|fri|sat|sun)\b/gi, "")
    .replace(/\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/g, "")
    .replace(/\b\d{1,2}:\d{2}(?:\s*[AP]M)?\b/gi, "")
    .replace(/\b(?:unread|read)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220) || normalizeMemoryText(candidate.label ?? candidate.text ?? "").slice(0, 220);
}

function buildMessageThreadListFingerprint(candidate = {}) {
  const seed = normalizeMemoryText(candidate.listFingerprint ?? candidate.label ?? candidate.text ?? candidate.href ?? "");
  return hashText(seed).slice(0, 32);
}

function normalizeMemoryText(text) {
  return String(text ?? "").replace(/[\t\u00a0]+/g, " ").replace(/\s+/g, " ").trim();
}

function uniqueTrackingNumbers(values = []) {
  return [...new Set(values.map((value) => String(value ?? "").replace(/[\s-]+/g, "").trim().toUpperCase()).filter(Boolean))];
}

function truncateForMemory(value, maxLength) {
  const normalized = normalizeMemoryText(value);
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function trimTrackingCaptureMemory(memory) {
  for (const collectionName of ["orders", "messages"]) {
    const entries = Object.entries(memory[collectionName] ?? {});
    if (entries.length <= TRACKING_CAPTURE_MEMORY_MAX_ENTRIES) continue;
    entries.sort(([, a], [, b]) => String(b?.lastSeenAt ?? b?.lastReadAt ?? "").localeCompare(String(a?.lastSeenAt ?? a?.lastReadAt ?? "")));
    memory[collectionName] = Object.fromEntries(entries.slice(0, TRACKING_CAPTURE_MEMORY_MAX_ENTRIES));
  }
}

export async function main() {
  try {
    const result = await run();
    const shouldNotify = verbose || jsonOnly || dryRun || profileInfo || result.loginRequired || result.imported > 0 || result.invoicesCreatedOrUpdated > 0 || result.errors.length > 0;

    if (!shouldNotify) return;

    if (jsonOnly || dryRun) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatResult(result));
    }
  } catch (error) {
    const message = `Alibaba portal agent failed: ${error instanceof Error ? error.message : String(error)}`;
    if (jsonOnly || dryRun) {
      console.log(JSON.stringify(emptyResult({ configured: false, errors: [message] }), null, 2));
    } else {
      console.log(message);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}

async function run() {
  fs.mkdirSync(downloadsDir, { recursive: true });
  fs.mkdirSync(path.dirname(statePath), { recursive: true });

  if (profileInfo) {
    return emptyResult({
      configured: true,
      browserProfile: publicBrowserProfile(browserProfile),
      message: `Alibaba portal agent will use ${formatBrowserProfile(browserProfile)}.`
    });
  }

  if (browserProfile.requiresExisting && !fs.existsSync(userDataDir)) {
    return emptyResult({
      configured: false,
      browserProfile: publicBrowserProfile(browserProfile),
      errors: [`Chrome user-data directory does not exist: ${userDataDir}`]
    });
  }
  if (!browserProfile.requiresExisting) fs.mkdirSync(userDataDir, { recursive: true });

  const { chromium } = await importPlaywright();
  const executablePath = findChromeExecutable();
  if (!executablePath) {
    return emptyResult({
      configured: false,
      browserProfile: publicBrowserProfile(browserProfile),
      errors: ["No Google Chrome executable found. Install Google Chrome or set LAMBENTI_ALIBABA_BROWSER_EXECUTABLE_PATH to chrome.exe in .env."]
    });
  }

  let context;
  let pendingManualHandoff;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath,
      headless,
      acceptDownloads: true,
      downloadsPath: downloadsDir,
      viewport: { width: 1440, height: 1000 },
      locale: "en-US",
      args: browserProfile.profileDirectory ? [`--profile-directory=${browserProfile.profileDirectory}`] : []
    });
  } catch (error) {
    const launchError = summarizeBrowserLaunchError(error);
    if ((setupLogin || trackingOnly) && browserLaunchCanUseManualChromeFallback(launchError)) {
      const manualHandoffUrl = startUrl;
      const manualOpen = openManualChromeProfileUrl(executablePath, browserProfile, manualHandoffUrl);
      const accountConfirmBefore = manualOpen.opened ? clickAlibabaAccountConfirmationInWindowsChrome(1_500) : { clicked: false };
      const savedGoogleAssist = manualOpen.opened && !accountConfirmBefore.clicked ? clickSavedGoogleContinueInWindowsChrome() : { clicked: false };
      const accountConfirmAfter = manualOpen.opened && !accountConfirmBefore.clicked ? clickAlibabaAccountConfirmationInWindowsChrome() : accountConfirmBefore;
      const clickedText = [
        savedGoogleAssist.clicked ? "clicked the saved Google sign-in button matching `Continue as Musashi`" : null,
        accountConfirmAfter.clicked ? "clicked Alibaba's `Yes` confirmation for the trusted Lambenti account" : null
      ].filter(Boolean);
      const assistText = clickedText.length > 0
        ? ` I also ${clickedText.join(" and ")}.`
        : " I did not see the saved Google `Continue as Musashi` or Alibaba `Yes` confirmation button before the timeout; use them manually if they appear, or sign in manually / rerun after closing Chrome for controlled credential entry.";
      if (trackingOnly && !setupLogin) {
        return emptyResult({
          configured: false,
          browserProfile: publicBrowserProfile(browserProfile),
          loginRequired: false,
          manualBrowserOpened: manualOpen.opened,
          savedGoogleContinueClicked: savedGoogleAssist.clicked,
          alibabaAccountConfirmClicked: accountConfirmAfter.clicked,
          trackingCaptureDeferred: true,
          errors: manualOpen.opened
            ? [`Opened ${manualHandoffUrl} in ${formatBrowserProfile(browserProfile)} and attempted saved-login assist.${assistText} Automatic tracking collection still needs controlled Chrome access; close Chrome windows using this profile and run Capture again, or complete any CAPTCHA/2FA/security check manually first.`]
            : manualOpen.errors,
          message: manualOpen.opened
            ? `Opened ${manualHandoffUrl} in ${formatBrowserProfile(browserProfile)} for safe login/tracking handoff, but controlled scraping could not start: ${launchError}`
            : `Could not open ${formatBrowserProfile(browserProfile)} in Google Chrome: ${launchError}`
        });
      }
      return emptyResult({
        configured: manualOpen.opened,
        browserProfile: publicBrowserProfile(browserProfile),
        loginRequired: !(savedGoogleAssist.clicked || accountConfirmAfter.clicked),
        manualBrowserOpened: manualOpen.opened,
        savedGoogleContinueClicked: savedGoogleAssist.clicked,
        alibabaAccountConfirmClicked: accountConfirmAfter.clicked,
        errors: manualOpen.opened ? [] : manualOpen.errors,
        message: manualOpen.opened
          ? `${formatBrowserProfile(browserProfile)} is already open, so Playwright cannot control it directly. I opened ${manualHandoffUrl} in that Chrome profile for manual Alibaba login.${assistText} If Chrome still shows about:blank, paste this URL into the active tab: ${manualHandoffUrl}. Complete any CAPTCHA/2FA/security check manually, close that Chrome window, then run Capture again.`
          : `Could not open ${formatBrowserProfile(browserProfile)} in Google Chrome: ${launchError}`
      });
    }
    return emptyResult({
      configured: false,
      browserProfile: publicBrowserProfile(browserProfile),
      errors: [
        `Could not open ${formatBrowserProfile(browserProfile)} in Google Chrome: ${launchError}`,
        "If this Chrome profile is already open, close Chrome windows using that profile and retry. Chrome/Playwright may refuse default-profile automation; CAPTCHA/security checks still require manual completion."
      ]
    });
  }

  try {
    const page = setupLogin ? await context.newPage() : (context.pages()[0] ?? await context.newPage());
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(60_000);
    if (browserStartupSettleMs > 0) await page.waitForTimeout(browserStartupSettleMs);

    if (setupLogin) {
      await page.goto(startUrl, { waitUntil: "domcontentloaded" });
      await page.bringToFront().catch(() => undefined);
      console.log("Alibaba login setup opened in Google Chrome.");
      console.log(`Opened URL: ${page.url()}`);
      if (/^about:blank$/i.test(page.url())) {
        console.log(`Chrome is still on about:blank; paste this URL into the active tab: ${startUrl}`);
      }
      let loginAssist = { savedGoogleContinueClicked: false, googleProviderClicked: false, accountConfirmationClicked: false, credentialsSubmitted: false };
      const setupLoginAssistEnabled = loginAssistEnabled && /^true$/i.test(process.env.LAMBENTI_ALIBABA_SETUP_LOGIN_ASSIST ?? "false");
      if (setupLoginAssistEnabled) {
        try {
          loginAssist = await assistAlibabaLogin(page, { allowCredentialPrompt: promptCredentials });
        } catch (error) {
          if (isManualInterventionError(error)) {
            console.log(error.message);
          } else {
            throw error;
          }
        }
      }
      if (loginAssist.savedGoogleContinueClicked) {
        console.log("Clicked the saved Google sign-in button matching `Continue as Musashi`.");
      } else if (loginAssist.googleProviderClicked) {
        console.log("Clicked Alibaba's `Continue with Google`; no saved `Continue as Musashi` button was detected before the timeout.");
      }
      if (loginAssist.accountConfirmationClicked) {
        console.log("Clicked Alibaba's `Yes` confirmation for the trusted Lambenti account.");
      }
      if (loginAssist.credentialsSubmitted) {
        console.log("Submitted the provided Alibaba login details without storing or logging them.");
      }
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
        browserProfile: publicBrowserProfile(browserProfile),
        setupComplete: true,
        message: `Alibaba Chrome session confirmed for ${formatBrowserProfile(browserProfile)}.`
      };
    }

    const snapshots = [];
    const errors = [];
    let loginRequired = false;
    let securityChallengeRequired = false;
    let autoLoginAttempted = false;
    const trackingMemory = trackingOnly ? startTrackingCaptureMemoryRun(readTrackingCaptureMemory()) : null;
    const trackingMemoryStats = trackingOnly ? createTrackingCaptureMemoryStats() : null;
    if (trackingMemory) {
      await hydrateTrackingCaptureMemoryFromSavedTrackingRows(trackingMemory, trackingMemoryStats);
      writeTrackingCaptureMemory(trackingMemory);
    }

    for (const target of buildPortalCaptureTargets(portalImportOptions)) {
      try {
        await page.goto(target.url, { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => undefined);
        if (authSettleMs > 0) await page.waitForTimeout(authSettleMs);

        const authState = await ensureAlibabaAuthenticated(page);
        loginRequired = loginRequired || authState.loginRequired;
        securityChallengeRequired = securityChallengeRequired || authState.securityChallengeRequired;
        autoLoginAttempted = autoLoginAttempted || authState.autoLoginAttempted;
        if (authState.loginRequired || authState.securityChallengeRequired) {
          if (trackingOnly) break;
          continue;
        }

        if (target.kind === "orders" && target.orderStatus) {
          const selectedStatus = await selectOrderStatusSurface(page, target.orderStatus);
          if (!selectedStatus) {
            errors.push(`${target.label}: could not identify the ${target.orderStatus} order tab; scanned the visible orders page as fallback.`);
          }
        }

        snapshots.push(...(await collectPortalSnapshots(context, page, target.kind, target, trackingMemory, trackingMemoryStats)));
      } catch (error) {
        if (isManualInterventionError(error)) {
          loginRequired = loginRequired || error.alibabaManualIntervention === "login";
          securityChallengeRequired = securityChallengeRequired || error.alibabaManualIntervention === "security";
          errors.push(`${target.kind}: ${error.message}`);
          continue;
        }
        errors.push(`${target.kind}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (trackingMemory) {
      finishTrackingCaptureMemoryRun(trackingMemory, trackingMemoryStats ?? {});
      writeTrackingCaptureMemory(trackingMemory);
    }

    const uniqueSnapshots = uniqueBySnapshotIdentity(snapshots).slice(0, positiveInt(process.env.LAMBENTI_ALIBABA_MAX_SNAPSHOTS, trackingOnly ? 200 : 20));
    const trackingMemoryResult = trackingMemory ? trackingCaptureMemorySummary(trackingMemory, trackingMemoryStats ?? {}) : undefined;

    if (securityChallengeRequired && uniqueSnapshots.length === 0) {
      const shouldRemind = trackingOnly || jsonOnly || dryRun || shouldEmitChallengeReminder();
      const opensManualHandoff = trackingOnly && !dryRun && !headless;
      const result = emptyResult({
        browserProfile: publicBrowserProfile(browserProfile),
        securityChallengeRequired: true,
        autoLoginAttempted,
        trackingCaptureDeferred: trackingOnly,
        trackingMemory: trackingMemoryResult,
        errors: shouldRemind ? [opensManualHandoff
          ? "Alibaba is showing a security/CAPTCHA/verification check. This agent cannot bypass it. I will leave the dedicated Alibaba automation Chrome profile open for manual completion; close that Chrome window after the check, then click Capture again."
          : "Alibaba is showing a security/CAPTCHA/verification check. This agent cannot bypass it. Complete the check in the dedicated Alibaba automation Chrome profile, close that Chrome window, then click Capture again."] : []
      });
      if (opensManualHandoff) {
        pendingManualHandoff = { result, kind: "security", url: page.url() || startUrl };
      }
      return result;
    }

    if (loginRequired && uniqueSnapshots.length === 0) {
      const shouldRemind = trackingOnly || jsonOnly || dryRun || shouldEmitLoginReminder();
      const opensManualHandoff = trackingOnly && !dryRun && !headless;
      const result = emptyResult({
        browserProfile: publicBrowserProfile(browserProfile),
        loginRequired: true,
        autoLoginAttempted,
        trackingCaptureDeferred: trackingOnly,
        trackingMemory: trackingMemoryResult,
        errors: shouldRemind ? [autoLoginAttempted
          ? (opensManualHandoff
              ? "Alibaba still requires manual login after trying Chrome's saved/autofilled login info. I will leave the dedicated Alibaba automation Chrome profile open for manual sign-in; close that Chrome window after login, then click Capture again."
              : "Alibaba still requires manual login after trying Chrome's saved/autofilled login info. Sign in in the dedicated Alibaba automation Chrome profile, close that Chrome window after login, then click Capture again.")
          : (opensManualHandoff
              ? "Alibaba login is required. I will leave the dedicated Alibaba automation Chrome profile open for manual sign-in; close that Chrome window after login, then click Capture again."
              : "Alibaba login is required. Sign in in the dedicated Alibaba automation Chrome profile, close that Chrome window after login, then click Capture again.")] : []
      });
      if (opensManualHandoff) {
        pendingManualHandoff = { result, kind: "login", url: page.url() || startUrl };
      }
      return result;
    }

    clearManualInterventionReminders();

    if (dryRun) {
      return {
        configured: true,
        browserProfile: publicBrowserProfile(browserProfile),
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
        trackingMemory: trackingMemoryResult,
        snapshots: uniqueSnapshots
      };
    }

    if (uniqueSnapshots.length === 0) {
      return emptyResult({ configured: true, browserProfile: publicBrowserProfile(browserProfile), errors, trackingMemory: trackingMemoryResult });
    }

    const importResult = await uploadSnapshots(uniqueSnapshots);
    return {
      configured: true,
      browserProfile: publicBrowserProfile(browserProfile),
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
      trackingMemory: trackingMemoryResult,
      reviewUrl: `${baseUrl}/integrations/alibaba-email`,
      invoicesUrl: `${baseUrl}/accounting/invoices`
    };
  } finally {
    await context.close();
    if (pendingManualHandoff) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      const manualOpen = openManualChromeProfileUrl(executablePath, browserProfile, pendingManualHandoff.url || startUrl);
      pendingManualHandoff.result.manualBrowserOpened = manualOpen.opened;
      if (manualOpen.opened) {
        pendingManualHandoff.result.errors.push(`Opened ${pendingManualHandoff.url || startUrl} in the dedicated Alibaba automation Chrome profile for manual ${pendingManualHandoff.kind === "security" ? "security check" : "login"}. Finish the handoff there, close that Chrome window, then click Capture again.`);
      } else {
        pendingManualHandoff.result.errors.push(...manualOpen.errors);
      }
    }
  }
}

async function selectOrderStatusSurface(page, status) {
  const candidateCount = await markOrderStatusSurfaceCandidates(page, status);
  if (candidateCount <= 0) return false;

  const locator = page.locator(`[data-alibaba-agent-order-status="${status}"]`).first();
  await locator.scrollIntoViewIfNeeded({ timeout: 1_500 }).catch(() => undefined);
  await locator.click({ timeout: 5_000 });
  await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: orderDetailNetworkIdleTimeoutMs }).catch(() => undefined);
  if (orderStatusSettleMs > 0) await page.waitForTimeout(orderStatusSettleMs);
  await scrollThroughPortalEvidence(page);
  return true;
}

async function markOrderStatusSurfaceCandidates(page, status) {
  return page.evaluate(({ status }) => {
    const normalize = (value) => String(value ?? "").replace(/[\t\u00a0]+/g, " ").replace(/\s+/g, " ").trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const completedReviewExact = /^(?:(?:completed|complete)\s*(?:&|and)\s*in\s*review|completed|complete|delivered|received|finished)(?:\s*[\(（]?\d+[\)）]?)?$/i;
    const deliveredExact = /^(?:delivered|completed|complete|received)(?:\s*[\(（]?\d+[\)）]?)?$/i;
    const deliveringExact = /^(?:delivering|shipped|shipping|in\s+transit|awaiting\s+delivery|to\s+receive|to\s+be\s+delivered)(?:\s*[\(（]?\d+[\)）]?)?$/i;
    const exactPattern = status === "completed-review" ? completedReviewExact : (status === "delivered" ? deliveredExact : deliveringExact);
    const reject = /(?:confirm|receipt|pay|payment|refund|dispute|delete|cancel|message|contact|send|reply|chat|track\s+shipment|view\s+details|order\s+details|invoice|logistics\s+details)/i;

    document.querySelectorAll("[data-alibaba-agent-order-status]").forEach((element) => {
      element.removeAttribute("data-alibaba-agent-order-status");
      element.removeAttribute("data-alibaba-agent-order-status-label");
    });

    const candidates = [];
    for (const element of Array.from(document.querySelectorAll("a, button, [role='tab'], [role='button'], [role='link'], [tabindex]"))) {
      if (!visible(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.top < 70 || rect.top > 460 || rect.height > 90 || rect.width > 360) continue;
      const label = normalize([
        element.innerText,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.textContent
      ].find(Boolean) ?? "");
      if (!label || label.length > 120) continue;
      if (!exactPattern.test(label)) continue;
      if (reject.test(label) && !/^(?:delivering|delivered)(?:\s*\(\d+\))?$/i.test(label)) continue;
      const role = element.getAttribute("role") ?? "";
      const ariaSelected = element.getAttribute("aria-selected") === "true";
      const selectedClass = /active|selected|current/i.test(element.className?.toString?.() ?? "");
      const score = (role === "tab" ? 10_000 : 0) + (ariaSelected || selectedClass ? 1_000 : 0) - Math.round(rect.top) - Math.round(rect.left / 10);
      candidates.push({ element, label, score });
    }

    candidates.sort((a, b) => b.score - a.score);
    const selected = candidates[0];
    if (!selected) return 0;
    selected.element.setAttribute("data-alibaba-agent-order-status", status);
    selected.element.setAttribute("data-alibaba-agent-order-status-label", selected.label.slice(0, 120));
    return 1;
  }, { status }).catch(() => 0);
}

async function collectPortalSnapshots(context, page, kind, target = {}, trackingMemory = null, trackingMemoryStats = null) {
  if (kind === "messages") return collectMessageCenterSnapshots(page, trackingMemory, trackingMemoryStats);

  const snapshots = [];
  await scrollThroughPortalEvidence(page);
  const currentDocs = trackingOnly ? [] : await downloadInvoiceDocuments(page);
  const currentSnapshot = await snapshotFromPage(page, kind, currentDocs, {
    subject: target.orderStatus ? `Alibaba portal ${target.orderStatus} orders surface` : undefined
  });
  if (currentSnapshot) {
    snapshots.push(currentSnapshot);
    rememberTrackingOrderSnapshot(trackingMemory, currentSnapshot, {
      source: target.label,
      status: target.orderStatus,
      stats: trackingMemoryStats
    });
  }

  const detailMode = trackingOnly && kind === "orders" ? "trackingDetail" : "detail";
  const candidateLimit = trackingOnly && target.orderStatus === "completed-review" ? maxCompletedReviewCandidates : maxCandidates;
  const candidateCount = await markCandidates(page, detailMode, candidateLimit, trackingMemory ? buildTrackingCaptureMemoryHints(trackingMemory) : {});
  for (let index = 0; index < candidateCount; index += 1) {
    const selector = `[data-alibaba-agent-detail="${index}"]`;
    const locator = page.locator(selector).first();
    const candidateLabel = await locator.getAttribute("data-alibaba-agent-detail-label").catch(() => "");
    const candidateText = await locator.getAttribute("data-alibaba-agent-detail-context").catch(() => "") || candidateLabel;
    const candidateKey = await locator.getAttribute("data-alibaba-agent-detail-key").catch(() => "") || buildTrackingOrderMemoryKey({ label: candidateLabel, text: candidateText });
    const candidateFingerprint = await locator.getAttribute("data-alibaba-agent-detail-fingerprint").catch(() => "") || buildTrackingOrderCandidateFingerprint({ label: candidateLabel, text: candidateText });
    const beforeUrl = page.url();

    if (trackingMemory) {
      const decision = shouldSkipTrackingOrderCandidate({ key: candidateKey, label: candidateLabel, text: candidateText, fingerprint: candidateFingerprint }, trackingMemory);
      if (decision.skip) {
        if (decision.reason === "waiting-supplier-to-ship" && trackingMemoryStats) trackingMemoryStats.orderCandidatesSkippedWaitingToShip += 1;
        if (decision.reason === "generic-logistics-services" && trackingMemoryStats) trackingMemoryStats.orderCandidatesSkippedGenericLogistics += 1;
        if (decision.reason === "tracking-already-captured" && trackingMemoryStats) trackingMemoryStats.orderCandidatesSkippedKnownTracking += 1;
        if (decision.reason === "already-checked-unchanged" && trackingMemoryStats) trackingMemoryStats.orderCandidatesSkippedAlreadyChecked += 1;
        continue;
      }
    }

    try {
      const popupPromise = context.waitForEvent("page", { timeout: 5_000 }).catch(() => null);
      const downloadPromise = page.waitForEvent("download", { timeout: 5_000 }).catch(() => null);
      if (trackingMemoryStats) trackingMemoryStats.orderCandidatesRead += 1;
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
        await popup.waitForLoadState("networkidle", { timeout: orderDetailNetworkIdleTimeoutMs }).catch(() => undefined);
        const docs = trackingOnly ? [] : await downloadInvoiceDocuments(popup);
        const popupSnapshot = await snapshotFromPage(popup, kind, docs, {
          subject: target.orderStatus ? `Alibaba portal ${target.orderStatus} order detail` : undefined
        });
        let candidateRemembered = false;
        if (popupSnapshot) {
          snapshots.push(popupSnapshot);
          rememberTrackingOrderSnapshot(trackingMemory, popupSnapshot, {
            candidateKey,
            candidateLabel,
            fingerprint: candidateFingerprint,
            source: target.label,
            status: target.orderStatus,
            stats: trackingMemoryStats
          });
          candidateRemembered = true;
        }
        if (trackingOnly) {
          const nestedSnapshots = await collectNestedTrackingButtonSnapshots(context, popup, kind, target, {
            candidateKey,
            candidateLabel,
            candidateFingerprint,
            trackingMemory,
            trackingMemoryStats
          });
          snapshots.push(...nestedSnapshots);
          if (nestedSnapshots.length > 0) candidateRemembered = true;
          if (!candidateRemembered) {
            rememberTrackingOrderCandidateAttempt(trackingMemory, {
              key: candidateKey,
              label: candidateLabel,
              text: candidateText,
              fingerprint: candidateFingerprint
            }, {
              source: target.label,
              status: target.orderStatus,
              stats: trackingMemoryStats
            });
          }
        }
        await popup.close().catch(() => undefined);
        continue;
      }

      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: orderDetailNetworkIdleTimeoutMs }).catch(() => undefined);
      const docs = trackingOnly ? [] : await downloadInvoiceDocuments(page);
      const detailSnapshot = await snapshotFromPage(page, kind, docs, {
        subject: target.orderStatus ? `Alibaba portal ${target.orderStatus} order detail` : undefined
      });
      let candidateRemembered = false;
      if (detailSnapshot) {
        snapshots.push(detailSnapshot);
        rememberTrackingOrderSnapshot(trackingMemory, detailSnapshot, {
          candidateKey,
          candidateLabel,
          fingerprint: candidateFingerprint,
          source: target.label,
          status: target.orderStatus,
          stats: trackingMemoryStats
        });
        candidateRemembered = true;
      }
      if (trackingOnly) {
        const nestedSnapshots = await collectNestedTrackingButtonSnapshots(context, page, kind, target, {
          candidateKey,
          candidateLabel,
          candidateFingerprint,
          trackingMemory,
          trackingMemoryStats
        });
        snapshots.push(...nestedSnapshots);
        if (nestedSnapshots.length > 0) candidateRemembered = true;
        if (!candidateRemembered) {
          rememberTrackingOrderCandidateAttempt(trackingMemory, {
            key: candidateKey,
            label: candidateLabel,
            text: candidateText,
            fingerprint: candidateFingerprint
          }, {
            source: target.label,
            status: target.orderStatus,
            stats: trackingMemoryStats
          });
        }
      }

      if (page.url() !== beforeUrl) {
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => page.goto(beforeUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined));
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
        await markCandidates(page, detailMode, candidateLimit, trackingMemory ? buildTrackingCaptureMemoryHints(trackingMemory) : {});
      }
    } catch (error) {
      if (isManualInterventionError(error)) throw error;
      if (page.url() !== beforeUrl) {
        await page.goto(beforeUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
        await markCandidates(page, detailMode, candidateLimit, trackingMemory ? buildTrackingCaptureMemoryHints(trackingMemory) : {}).catch(() => undefined);
      }
    }
  }

  return snapshots;
}

async function collectNestedTrackingButtonSnapshots(context, page, kind, target = {}, options = {}) {
  const maxLayers = Math.max(0, Number(options.remainingLayers ?? maxTrackingClickLayers) || 0);
  if (maxLayers <= 0 || page.isClosed?.()) return [];

  const snapshots = [];
  const clickedFingerprints = new Set(options.clickedFingerprints ?? []);
  const startUrl = page.url();

  try {
    for (let layer = 0; layer < maxLayers; layer += 1) {
      await scrollThroughPortalEvidence(page);
      const candidateCount = await markTrackingActionCandidates(page, maxTrackingButtonsPerLayer, [...clickedFingerprints]);
      if (candidateCount <= 0) break;

      let clickedAtThisLayer = false;
      for (let index = 0; index < candidateCount; index += 1) {
        const selector = `[data-alibaba-agent-tracking-action="${index}"]`;
        const locator = page.locator(selector).first();
        const label = await locator.getAttribute("data-alibaba-agent-tracking-action-label").catch(() => "");
        const fingerprint = await locator.getAttribute("data-alibaba-agent-tracking-action-fingerprint").catch(() => "") || `${layer}:${index}:${label}`;
        if (clickedFingerprints.has(fingerprint)) continue;

        const beforeUrl = page.url();
        try {
          const popupPromise = context.waitForEvent("page", { timeout: 4_000 }).catch(() => null);
          await locator.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => undefined);
          await locator.click({ timeout: 10_000 });
          clickedFingerprints.add(fingerprint);
          clickedAtThisLayer = true;

          const popup = await popupPromise;
          const targetPage = popup ?? page;
          await targetPage.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
          await targetPage.waitForLoadState("networkidle", { timeout: orderDetailNetworkIdleTimeoutMs }).catch(() => undefined);
          if (orderStatusSettleMs > 0) await targetPage.waitForTimeout(orderStatusSettleMs);

          const authState = await getAlibabaAuthState(targetPage);
          if (authState.securityChallengeRequired) throw manualInterventionError("security", "Alibaba showed a security/CAPTCHA/verification check while opening a tracking/logistics button.");
          if (authState.loginRequired) throw manualInterventionError("login", "Alibaba required login while opening a tracking/logistics button.");

          await scrollThroughPortalEvidence(targetPage);
          const snapshot = await snapshotFromPage(targetPage, kind, [], {
            subject: target.orderStatus
              ? `Alibaba portal ${target.orderStatus} tracking button layer ${layer + 1}`
              : `Alibaba portal tracking button layer ${layer + 1}`
          });
          if (snapshot) {
            snapshots.push(snapshot);
            rememberTrackingOrderSnapshot(options.trackingMemory, snapshot, {
              candidateKey: options.candidateKey,
              candidateLabel: options.candidateLabel || label,
              fingerprint: options.candidateFingerprint,
              source: target.label,
              status: target.orderStatus,
              stats: options.trackingMemoryStats
            });
            if (snapshotHasTrackingNumbers(snapshot)) {
              if (popup) await popup.close().catch(() => undefined);
              return snapshots;
            }
          }

          if (popup) {
            snapshots.push(...(await collectNestedTrackingButtonSnapshots(context, popup, kind, target, {
              ...options,
              remainingLayers: Math.max(0, maxLayers - layer - 1),
              clickedFingerprints
            })));
            await popup.close().catch(() => undefined);
            if (snapshots.some(snapshotHasTrackingNumbers)) return snapshots;
            continue;
          }

          // Track Package / Track Shipment(s) often reveals a second button or logistics panel in-place.
          // Re-mark from the new screen/panel on the next layer rather than clicking stale handles.
          if (page.url() !== beforeUrl || clickedAtThisLayer) break;
        } catch (error) {
          if (isManualInterventionError(error)) throw error;
          if (page.url() !== beforeUrl) {
            await page.goto(beforeUrl, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
          }
        }
      }

      if (!clickedAtThisLayer) break;
      if (snapshots.some(snapshotHasTrackingNumbers)) break;
    }
  } finally {
    if (!page.isClosed?.() && page.url() !== startUrl) {
      await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: orderDetailNetworkIdleTimeoutMs }).catch(() => undefined);
    }
  }

  return snapshots;
}

function snapshotHasTrackingNumbers(snapshot) {
  return uniqueTrackingNumbers(snapshot?.trackingNumbers ?? extractTrackingNumbers(snapshot?.text ?? "")).length > 0;
}

async function markTrackingActionCandidates(page, limit, clickedFingerprints = []) {
  return page.evaluate(({ limit, clickedFingerprints, excludePattern }) => {
    const normalize = (value) => String(value ?? "").replace(/[\t\u00a0]+/g, " ").replace(/\s+/g, " ").trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const simpleHash = (value) => {
      let hash = 0;
      for (let index = 0; index < value.length; index += 1) {
        hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
      }
      return Math.abs(hash).toString(16);
    };
    const exclude = new RegExp(excludePattern, "i");
    const trackAction = /(?:\btrack\s+(?:package|shipment(?:\(s\)|s)?|order)\b|\btrack\s+shipment\(s\)\b|\bview\s+tracking\b|\btracking\s+details?\b|\bshipment\s+details?\b|\bshipping\s+details?\b|\blogistics(?:\s+details?)?\b|\bwaybill\b|运单|物流|追踪)/i;
    document.querySelectorAll("[data-alibaba-agent-tracking-action]").forEach((element) => {
      element.removeAttribute("data-alibaba-agent-tracking-action");
      element.removeAttribute("data-alibaba-agent-tracking-action-label");
      element.removeAttribute("data-alibaba-agent-tracking-action-fingerprint");
    });

    const clicked = new Set(clickedFingerprints);
    const candidates = [];
    for (const element of Array.from(document.querySelectorAll("a, button, [role='button'], [role='link']"))) {
      if (!visible(element)) continue;
      const rect = element.getBoundingClientRect();
      const href = element.closest?.("a[href]")?.getAttribute?.("href") || element.getAttribute("href") || "";
      const label = normalize([
        element.innerText,
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        href
      ].filter(Boolean).join(" "));
      if (!label || label.length > 700) continue;
      if (/(?:buyer_market_list|logistics\.alibaba\.com\/buyer\/luyou\/blg|\blogistics\s+services?\b)/i.test(`${label}\n${href}`)) continue;
      if (!trackAction.test(label) || exclude.test(label)) continue;
      const fingerprint = simpleHash(`${label}\n${href}\n${Math.round(rect.top)}:${Math.round(rect.left)}`);
      if (clicked.has(fingerprint)) continue;
      const exactTrackPackage = /\btrack\s+(?:package|shipment(?:\(s\)|s)?|order)\b/i.test(label);
      const score = (exactTrackPackage ? 10_000 : 0) + Math.max(0, 2_000 - Math.round(rect.top)) - Math.round(rect.left / 10);
      candidates.push({ element, label, fingerprint, score });
    }

    candidates.sort((a, b) => b.score - a.score);
    candidates.slice(0, limit).forEach((candidate, index) => {
      candidate.element.setAttribute("data-alibaba-agent-tracking-action", String(index));
      candidate.element.setAttribute("data-alibaba-agent-tracking-action-label", candidate.label.slice(0, 240));
      candidate.element.setAttribute("data-alibaba-agent-tracking-action-fingerprint", candidate.fingerprint);
    });
    return Math.min(candidates.length, limit);
  }, { limit, clickedFingerprints, excludePattern: ALIBABA_PORTAL_CANDIDATE_PATTERN_SOURCES.detail.exclude });
}

function rememberTrackingOrderSnapshot(trackingMemory, snapshot, options = {}) {
  if (!trackingMemory || !snapshot) return;
  const trackingNumbers = uniqueTrackingNumbers(snapshot.trackingNumbers ?? extractTrackingNumbers(snapshot.text ?? ""));
  const orderId = snapshot.orderId || extractOrderId(`${snapshot.sourceUrl ?? ""}\n${snapshot.text ?? ""}`);
  const key = options.candidateKey || buildTrackingOrderMemoryKey({
    orderId,
    sourceUrl: snapshot.sourceUrl,
    label: options.candidateLabel,
    text: snapshot.text
  });
  recordTrackingOrderRead(trackingMemory, {
    key,
    label: options.candidateLabel || snapshot.subject || snapshot.sourceUrl,
    orderId,
    status: snapshot.orderStatus || options.status,
    source: options.source,
    fingerprint: options.fingerprint || hashText(normalizeMemoryText(snapshot.text ?? "")).slice(0, 32),
    trackingNumbers
  });
  if (options.stats) options.stats.orderReadsRemembered += 1;
  writeTrackingCaptureMemory(trackingMemory);
}

function rememberTrackingOrderCandidateAttempt(trackingMemory, input = {}, options = {}) {
  if (!trackingMemory || !input.key) return;
  recordTrackingOrderRead(trackingMemory, {
    key: input.key,
    label: input.label,
    text: input.text,
    fingerprint: input.fingerprint,
    trackingNumbers: input.trackingNumbers ?? [],
    source: options.source,
    status: options.status
  });
  if (options.stats) options.stats.orderReadsRemembered += 1;
  writeTrackingCaptureMemory(trackingMemory);
}

async function collectMessageCenterSnapshots(page, trackingMemory = null, trackingMemoryStats = null) {
  const snapshots = [];
  const seenThreads = new Set();
  await scrollMessageThreadList(page, "top");
  await scrollThroughPortalEvidence(page);

  for (let scrollStep = 0; scrollStep < maxMessageListScrolls && seenThreads.size < maxMessageThreads; scrollStep += 1) {
    const remaining = Math.max(1, maxMessageThreads - seenThreads.size);
    const candidateCount = await markMessageThreadCandidates(page, remaining, trackingMemory ? buildTrackingCaptureMemoryHints(trackingMemory).readMessages : {});
    let attemptedInBatch = 0;

    for (let index = 0; index < candidateCount && seenThreads.size < maxMessageThreads; index += 1) {
      const selector = `[data-alibaba-agent-message-thread="${index}"]`;
      const locator = page.locator(selector).first();
      const label = await locator.getAttribute("data-alibaba-agent-message-label").catch(() => "");
      const key = await locator.getAttribute("data-alibaba-agent-message-key").catch(() => "") || `${scrollStep}:${index}:${label}`;
      const listFingerprint = await locator.getAttribute("data-alibaba-agent-message-list-fingerprint").catch(() => "") || buildMessageThreadListFingerprint({ label });
      if (trackingMemory) {
        const decision = shouldReadMessageThread({ key, label, listFingerprint }, trackingMemory);
        if (!decision.read) {
          trackingMemoryStats.messageThreadsSkippedStale += 1;
          continue;
        }
      }
      if (seenThreads.has(key)) continue;
      seenThreads.add(key);
      attemptedInBatch += 1;

      const beforeUrl = page.url();
      try {
        await locator.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => undefined);
        if (trackingMemoryStats) trackingMemoryStats.messageThreadsRead += 1;
        await locator.click({ timeout: 10_000 });
        await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
        await page.waitForLoadState("networkidle", { timeout: messageThreadNetworkIdleTimeoutMs }).catch(() => undefined);
        if (messageThreadSettleMs > 0) await page.waitForTimeout(messageThreadSettleMs);

        const authState = await getAlibabaAuthState(page);
        if (authState.securityChallengeRequired) throw manualInterventionError("security", "Alibaba showed a security/CAPTCHA/verification check while opening a message thread.");
        if (authState.loginRequired) throw manualInterventionError("login", "Alibaba required login while opening a message thread.");

        await scrollActiveMessageSection(page);
        const section = await collectActiveMessageSectionText(page);
        const sectionText = [
          label ? `Thread list entry: ${label}` : undefined,
          section.title ? `Message section: ${section.title}` : undefined,
          section.text
        ].filter(Boolean).join("\n");

        const hasTrackingContext = hasShippingTrackingMessageContext(sectionText);
        rememberMessageThreadSnapshot(trackingMemory, {
          key,
          label,
          listFingerprint,
          sectionText,
          hasShippingTrackingContext: hasTrackingContext,
          stats: trackingMemoryStats
        });

        if (!hasTrackingContext) continue;
        const threadHash = hashText(`${key}\n${sectionText}`).slice(0, 16);
        const snapshot = await snapshotFromPage(page, "messages", [], {
          sourceUrl: `${page.url()}#message-thread-${threadHash}`,
          subject: section.title ? `Alibaba portal message thread: ${section.title}` : "Alibaba portal message thread",
          text: sectionText
        });
        if (snapshot) snapshots.push(snapshot);

        if (page.url() !== beforeUrl && !/message\.alibaba\.com/i.test(page.url())) {
          await page.goto(beforeUrl, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
        }
      } catch (error) {
        if (isManualInterventionError(error)) throw error;
        if (page.url() !== beforeUrl && !/message\.alibaba\.com/i.test(page.url())) {
          await page.goto(beforeUrl, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
        }
      }
    }

    const moved = await scrollMessageThreadList(page, "down");
    if (!moved && attemptedInBatch === 0) break;
    if (!moved && seenThreads.size >= candidateCount) break;
  }

  if (snapshots.length === 0 && (!trackingOnly || !trackingMemory || trackingMemoryStats?.messageThreadsRead > 0 || Object.keys(trackingMemory.messages ?? {}).length === 0)) {
    const fallbackText = await getBodyText(page);
    if (hasShippingTrackingMessageContext(fallbackText)) {
      const snapshot = await snapshotFromPage(page, "messages", [], {
        sourceUrl: `${page.url()}#message-center-visible`,
        subject: "Alibaba portal message center visible shipping/tracking text",
        text: fallbackText
      });
      if (snapshot) snapshots.push(snapshot);
    }
  }

  return snapshots;
}

function rememberMessageThreadSnapshot(trackingMemory, input = {}) {
  if (!trackingMemory) return;
  recordMessageThreadRead(trackingMemory, {
    key: input.key,
    label: input.label,
    listFingerprint: input.listFingerprint,
    sectionText: input.sectionText,
    hasShippingTrackingContext: input.hasShippingTrackingContext,
    trackingNumbers: extractTrackingNumbers(input.sectionText ?? "")
  });
  if (input.stats) input.stats.messageThreadsRemembered += 1;
  writeTrackingCaptureMemory(trackingMemory);
}

async function markMessageThreadCandidates(page, limit, readMessages = {}) {
  return page.evaluate(({ limit, excludePattern, readMessages }) => {
    const normalize = (value) => String(value ?? "").replace(/[\t\u00a0]+/g, " ").replace(/\s+/g, " ").trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const simpleHash = (value) => {
      let hash = 0;
      for (let index = 0; index < value.length; index += 1) {
        hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
      }
      return Math.abs(hash).toString(16);
    };
    const stableThreadSeed = (element, text) => {
      const closest = element.closest?.("a[href], [data-conversation-id], [data-thread-id], [data-id], [data-uid]");
      const href = closest?.getAttribute?.("href") || element.getAttribute("href") || "";
      if (href) {
        try {
          const url = new URL(href, window.location.href);
          for (const name of ["conversationId", "conversation_id", "threadId", "thread_id", "cid", "id", "uid"]) {
            const value = url.searchParams.get(name);
            if (value) return `${name}:${value}`;
          }
          if (!/\/message\/messenger\.htm$/i.test(url.pathname)) return `${url.hostname}${url.pathname}`.replace(/\/+$/, "");
        } catch {
          return href;
        }
      }
      for (const attr of ["data-conversation-id", "data-thread-id", "data-id", "data-uid", "aria-controls"]) {
        const value = closest?.getAttribute?.(attr) || element.getAttribute(attr);
        if (value) return `${attr}:${value}`;
      }
      const firstLine = String(text ?? "").split(/\r?\n/).map(normalize).find(Boolean) || normalize(text);
      return firstLine
        .replace(/\b(?:today|yesterday|mon|tue|wed|thu|fri|sat|sun)\b/gi, "")
        .replace(/\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/g, "")
        .replace(/\b\d{1,2}:\d{2}(?:\s*[AP]M)?\b/gi, "")
        .replace(/\b(?:unread|read)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 220) || normalize(text).slice(0, 220);
    };
    const exclude = new RegExp(excludePattern, "i");
    const threadSignal = /(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|today|yesterday|message|order|ship|shipment|shipping|tracking|logistics|waybill|supplier|seller|thanks|welcome|assist|ok\b|ltd\.?|co\.?|company|tech|electro|hardware|textil|insula|youm|消息|订单|发货|物流|运单)/i;
    const uiNoise = /^(?:all|unread|inbox|search|free trial|customer service|tell us about your communication experience|my alibaba)$/i;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1440;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1000;
    document.querySelectorAll("[data-alibaba-agent-message-thread]").forEach((element) => {
      element.removeAttribute("data-alibaba-agent-message-thread");
      element.removeAttribute("data-alibaba-agent-message-label");
      element.removeAttribute("data-alibaba-agent-message-key");
      element.removeAttribute("data-alibaba-agent-message-list-fingerprint");
    });

    const rawCandidates = [];
    for (const element of Array.from(document.querySelectorAll("a, button, [role='button'], [role='option'], [role='listitem'], li, [tabindex], div"))) {
      if (!visible(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.top < 90 || rect.bottom > viewportHeight + 40) continue;
      if (rect.left < 150 || rect.left > viewportWidth * 0.68) continue;
      if (rect.width < 120 || rect.width > viewportWidth * 0.48) continue;
      if (rect.height < 28 || rect.height > 170) continue;
      const text = normalize([
        element.innerText,
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title")
      ].filter(Boolean).join(" "));
      if (text.length < 2 || text.length > 650) continue;
      if (uiNoise.test(text) || exclude.test(text) || !threadSignal.test(text)) continue;
      const key = `message-thread:${simpleHash(stableThreadSeed(element, text))}`;
      const fingerprint = simpleHash(text);
      if (readMessages?.[key] && readMessages[key] === fingerprint) continue;
      rawCandidates.push({ element, text, key, fingerprint, top: rect.top, bottom: rect.bottom, left: rect.left, area: rect.width * rect.height });
    }

    rawCandidates.sort((a, b) => a.top - b.top || a.area - b.area);
    const selected = [];
    for (const candidate of rawCandidates) {
      const candidateCenter = (candidate.top + candidate.bottom) / 2;
      const candidateTextLower = candidate.text.toLowerCase();
      const duplicateThreadCard = selected.some((existing) => {
        const existingCenter = (existing.top + existing.bottom) / 2;
        const existingTextLower = existing.text.toLowerCase();
        const sameTextFamily = candidateTextLower.length > 32
          && existingTextLower.length > 32
          && (candidateTextLower.includes(existingTextLower) || existingTextLower.includes(candidateTextLower));
        const sameVisualRow = Math.abs(existingCenter - candidateCenter) < 48 && Math.abs(existing.left - candidate.left) < 96;
        return existing.text === candidate.text || sameTextFamily || sameVisualRow;
      });
      if (duplicateThreadCard) continue;
      selected.push(candidate);
      if (selected.length >= limit) break;
    }

    selected.forEach((candidate, index) => {
      const label = candidate.text.slice(0, 240);
      candidate.element.setAttribute("data-alibaba-agent-message-thread", String(index));
      candidate.element.setAttribute("data-alibaba-agent-message-label", label);
      candidate.element.setAttribute("data-alibaba-agent-message-key", candidate.key);
      candidate.element.setAttribute("data-alibaba-agent-message-list-fingerprint", candidate.fingerprint);
    });

    return selected.length;
  }, { limit, excludePattern: ALIBABA_PORTAL_CANDIDATE_PATTERN_SOURCES.detail.exclude, readMessages });
}

async function scrollMessageThreadList(page, direction) {
  return page.evaluate(async ({ direction }) => {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1440;
    const containers = Array.from(document.querySelectorAll("main, section, div, ul, [role='list'], [role='feed'], [role='grid']"))
      .filter(visible)
      .filter((element) => element.scrollHeight > element.clientHeight + 80)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const text = String(element.innerText ?? element.textContent ?? "");
        const threadSignals = (text.match(/(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|message|ship|tracking|supplier|ltd|co\.|thanks|assist|消息|发货|物流)/gi) ?? []).length;
        const inMessageListLane = rect.left >= 150 && rect.left <= viewportWidth * 0.68 && rect.width >= 180 && rect.width <= viewportWidth * 0.52;
        return { element, rect, score: (inMessageListLane ? 10_000 : 0) + threadSignals * 500 + element.scrollHeight - Math.abs(rect.left - viewportWidth * 0.25) };
      })
      .sort((a, b) => b.score - a.score);
    const target = containers[0]?.element;
    if (!target) return false;
    const before = target.scrollTop;
    if (direction === "top") {
      target.scrollTop = 0;
    } else {
      target.scrollTop = Math.min(target.scrollHeight, target.scrollTop + Math.max(240, Math.floor(target.clientHeight * 0.85)));
    }
    target.dispatchEvent(new Event("scroll", { bubbles: true }));
    window.dispatchEvent(new Event("scroll"));
    await pause(250);
    return Math.abs(target.scrollTop - before) > 4;
  }, { direction }).catch(() => false);
}

async function scrollActiveMessageSection(page) {
  await page.evaluate(async () => {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1440;
    const containers = Array.from(document.querySelectorAll("main, section, div, [role='feed'], [role='log']"))
      .filter(visible)
      .filter((element) => element.scrollHeight > element.clientHeight + 80)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left > viewportWidth * 0.32 && rect.width > viewportWidth * 0.28 && rect.height > 120;
      })
      .sort((a, b) => b.scrollHeight - a.scrollHeight)
      .slice(0, 3);
    for (const element of containers) {
      const originalTop = element.scrollTop;
      element.scrollTop = 0;
      for (let step = 0; step < 10; step += 1) {
        element.scrollTop = Math.min(element.scrollHeight, element.scrollTop + Math.max(250, element.clientHeight || window.innerHeight));
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
        await pause(150);
        if (element.scrollTop + element.clientHeight >= element.scrollHeight - 2) break;
      }
      element.scrollTop = originalTop;
    }
  }).catch(() => undefined);
}

async function collectActiveMessageSectionText(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value ?? "").replace(/[\t\u00a0]+/g, " ").replace(/\s{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1440;
    const shippingPattern = /(?:tracking|track|shipment|shipping|ship\s*out|shipped|logistics|waybill|carrier|delivered|delivery|eta|package|parcel|dispatch|freight|customs|运单|物流|快递|追踪|发货|送达)/i;
    const adOrComposerNoise = /(?:Accio\s+Work|Free\s+trial|Type\s+a\s+message|Send\s+message|Reply\s+to\s+supplier|Customer\s+service)/i;
    const candidates = [];

    for (const element of Array.from(document.querySelectorAll("main, section, article, [role='main'], [role='feed'], [role='log'], [role='article'], div"))) {
      if (!visible(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.left < viewportWidth * 0.30) continue;
      if (rect.width < viewportWidth * 0.24 || rect.height < 80) continue;
      const text = normalize(element.innerText ?? element.textContent ?? "");
      if (text.length < 20 || text.length > 80_000) continue;
      const shippingHits = (text.match(new RegExp(shippingPattern.source, "gi")) ?? []).length;
      const penalty = adOrComposerNoise.test(text) && shippingHits === 0 ? 20_000 : 0;
      candidates.push({
        text,
        title: normalize(element.getAttribute("aria-label") ?? element.getAttribute("title") ?? ""),
        score: shippingHits * 10_000 + Math.min(text.length, 20_000) - penalty - Math.round(rect.left)
      });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] ?? { text: normalize(document.body?.innerText ?? document.body?.textContent ?? ""), title: document.title ?? "" };
  });
}

async function scrollThroughPortalEvidence(page) {
  if (!(trackingOnly || args.has("--deep"))) return;
  await page.evaluate(async ({ containerLimit, scrollSteps, pauseMs }) => {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const scrollables = [
      document.scrollingElement,
      document.documentElement,
      document.body,
      ...Array.from(document.querySelectorAll("main, section, div, ul, [role='list'], [role='feed'], [role='grid'], [role='table']"))
    ].filter((element, index, all) => element && all.indexOf(element) === index)
      .filter((element) => element.scrollHeight > element.clientHeight + 80)
      .slice(0, containerLimit);

    for (const element of scrollables) {
      const originalTop = element.scrollTop;
      for (let step = 0; step < scrollSteps; step += 1) {
        element.scrollTop = Math.min(element.scrollHeight, element.scrollTop + Math.max(250, element.clientHeight || window.innerHeight));
        window.dispatchEvent(new Event("scroll"));
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
        await pause(pauseMs);
        if (element.scrollTop + element.clientHeight >= element.scrollHeight - 2) break;
      }
      element.scrollTop = originalTop;
    }
  }, { containerLimit: portalScrollContainerLimit, scrollSteps: portalScrollSteps, pauseMs: portalScrollPauseMs }).catch(() => undefined);
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
      const authState = await getAlibabaAuthState(page);
      if (authState.securityChallengeRequired) throw manualInterventionError("security", "Alibaba showed a security/CAPTCHA/verification check while opening an invoice or detail link.");
      if (authState.loginRequired) throw manualInterventionError("login", "Alibaba required login while opening an invoice or detail link.");
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
    } catch (error) {
      if (isManualInterventionError(error)) throw error;
      if (page.url() !== startingUrl) {
        await page.goto(startingUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      }
    }
  }

  return uniqueInvoiceDocuments(documents);
}

async function snapshotFromPage(page, kind, invoiceDocuments = [], options = {}) {
  const text = options.text ?? await getBodyText(page);
  const sourceUrl = options.sourceUrl ?? page.url();
  const authState = detectAlibabaAuthState({ url: sourceUrl, text });
  if (authState.securityChallengeRequired) throw manualInterventionError("security", "Alibaba showed a security/CAPTCHA/verification check while navigating portal evidence pages.");
  if (authState.loginRequired) throw manualInterventionError("login", "Alibaba required login while navigating portal evidence pages.");
  if (!looksRelevant(text) && !(kind === "messages" && hasShippingTrackingMessageContext(text))) return null;
  if (kind === "messages" && !hasShippingTrackingMessageContext(text)) return null;
  if (trackingOnly && !isRecentPortalEvidence(text, { now: trackingScrapeNow, months: trackingRecentMonths })) return null;
  const pageTitle = await page.title().catch(() => "Alibaba portal");
  const orderId = extractOrderId(`${sourceUrl}\n${text}`);
  const orderStatus = extractOrderStatus(text);
  const orderDate = extractPortalEvidenceDate(text)?.toISOString();
  const supplierName = extractSupplierName(text);
  const trackingNumbers = extractTrackingNumbers(text);
  const conversationContext = kind === "messages" ? extractConversationContext(text) : undefined;

  return {
    sourceUrl,
    pageTitle,
    capturedAt: new Date().toISOString(),
    subject: options.subject ?? (kind === "messages" ? "Alibaba portal message" : "Alibaba portal order detail"),
    messageId: options.messageId ?? buildPortalMessageId({ orderId, sourceUrl, text }),
    orderId,
    orderStatus,
    orderDate,
    supplierName,
    trackingNumbers,
    conversationContext,
    text,
    invoiceDocuments
  };
}

async function markCandidates(page, mode, limit, hints = {}) {
  return page.evaluate(({ mode, limit, patterns, skipOrderKeys, readOrders }) => {
    const pattern = patterns[mode] ?? patterns.detail;
    const include = new RegExp(pattern.include, "i");
    const exclude = new RegExp(pattern.exclude, "i");
    const attr = mode === "invoice" ? "data-alibaba-agent-invoice" : "data-alibaba-agent-detail";
    const normalize = (value) => String(value ?? "").replace(/[\t\u00a0]+/g, " ").replace(/\s+/g, " ").trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const simpleHash = (value) => {
      let hash = 0;
      for (let index = 0; index < value.length; index += 1) {
        hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
      }
      return Math.abs(hash).toString(16);
    };
    const buildOrderKey = (text) => {
      const orderId = String(text ?? "").match(/(?:orderId|order_id|orderNumber|order_number)[=:/#-]?\s*([0-9]{10,24})/i)
        ?? String(text ?? "").match(/(?:order\s*(?:id|no\.?|number|#)|trade\s+assurance\s+order|订单(?:编号|号)?|订单\s*ID)\s*[:.#=-]?\s*([0-9]{10,24})/i)
        ?? String(text ?? "").match(/[?&](?:orderId|order_id|orderNumber|order_number)=([0-9]{10,24})/i);
      return orderId?.[1] ? `order:${orderId[1]}` : `order-candidate:${simpleHash(normalize(text).slice(0, 2_000) || "unknown-order-candidate")}`;
    };
    const actionText = (element) => normalize([
      element.innerText,
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("href")
    ].filter(Boolean).join(" "));
    const closestHref = (element) => element.closest?.("a[href]")?.getAttribute?.("href") || element.getAttribute("href") || "";
    const orderContextText = (element, label) => {
      const candidates = [];
      for (let current = element, depth = 0; current && current instanceof HTMLElement && current !== document.body && depth < 9; current = current.parentElement, depth += 1) {
        const rect = current.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.height > 620 || rect.width < 80) continue;
        const text = normalize(current.innerText ?? current.textContent ?? "");
        if (!text || text.length < Math.max(6, label.length) || text.length > 5_000) continue;
        const signalCount = (text.match(/(?:order|trade\s+assurance|supplier|seller|status|completed|review|delivering|shipment|shipping|tracking|track\s+(?:package|shipment|order)|logistics|waybill|waiting\s+for\s+supplier|订单|供应商|卖家|状态|完成|发货|物流|运单|追踪)/gi) ?? []).length;
        const orderIdMatch = /(?:orderId|order_id|order\s*(?:id|no\.?|number|#)|订单(?:编号|号)?)[=:/#：\s-]*[0-9]{10,24}/i.test(text);
        if (signalCount > 0 || orderIdMatch) candidates.push({ text, score: signalCount * 1000 + (orderIdMatch ? 5000 : 0) - depth * 50 - Math.round(text.length / 20) });
      }
      candidates.sort((a, b) => b.score - a.score);
      return candidates[0]?.text ?? label;
    };
    const waitingForSupplierToShip = /(?:waiting\s+for\s+(?:the\s+)?supplier\s+to\s+ship|awaiting\s+supplier\s+ship(?:ment)?|supplier\s+has\s+not\s+shipped|to\s+be\s+shipped\s+by\s+supplier|待发货|等待供应商发货)/i;
    document.querySelectorAll(`[${attr}]`).forEach((element) => {
      element.removeAttribute(attr);
      element.removeAttribute("data-alibaba-agent-detail-label");
      element.removeAttribute("data-alibaba-agent-detail-key");
      element.removeAttribute("data-alibaba-agent-detail-fingerprint");
      element.removeAttribute("data-alibaba-agent-detail-context");
    });
    const rawCandidates = [];

    for (const element of Array.from(document.querySelectorAll("a, button, [role='button'], [role='link']"))) {
      if (!visible(element)) continue;
      const label = actionText(element);
      if (!label) continue;
      const href = closestHref(element);
      const context = mode === "trackingDetail" ? orderContextText(element, label) : label;
      const candidateText = normalize([href, label, context].filter(Boolean).join("\n"));

      if (!include.test(candidateText) || exclude.test(label)) continue;
      const key = buildOrderKey(candidateText);
      const fingerprint = simpleHash(candidateText);
      const readOrder = readOrders?.[key];
      if (mode === "trackingDetail") {
        if (/(?:buyer_market_list|logistics\.alibaba\.com\/buyer\/luyou\/blg|\blogistics\s+services?\b)/i.test(`${label}\n${href}\n${candidateText}`)) continue;
        if (waitingForSupplierToShip.test(candidateText)) continue;
        if (Array.isArray(skipOrderKeys) && skipOrderKeys.includes(key)) continue;
        if (readOrder?.hasTracking || (readOrder?.lastFingerprint && readOrder.lastFingerprint === fingerprint)) continue;
      }
      const rect = element.getBoundingClientRect();
      const exactTrackingAction = /\btrack\s+(?:package|shipment(?:\(s\)|s)?|order)\b|\btrack\s+shipment\(s\)\b/i.test(label);
      const logisticsAction = /(?:logistics|waybill|tracking\s+details?|shipment\s+details?|shipping\s+details?|物流|运单|追踪)/i.test(label);
      const detailAction = /(?:summary\s+details?|order\s+details?|view\s+order|details?|订单详情)/i.test(label);
      const contextSignalCount = (candidateText.match(/(?:order|supplier|seller|completed|review|delivering|shipment|tracking|logistics|waybill|订单|供应商|物流|运单|追踪)/gi) ?? []).length;
      const score = (exactTrackingAction ? 20_000 : 0)
        + (logisticsAction ? 12_000 : 0)
        + (detailAction ? 4_000 : 0)
        + contextSignalCount * 250
        - Math.round(rect.top)
        - Math.round(rect.left / 10)
        - Math.round(label.length / 25);
      rawCandidates.push({ element, label, key, fingerprint, context, score });
    }

    rawCandidates.sort((a, b) => b.score - a.score);
    const selected = [];
    const seen = new Set();
    for (const candidate of rawCandidates) {
      const dedupeKey = mode === "trackingDetail"
        ? `${candidate.key}:${candidate.fingerprint}`
        : `${candidate.label}:${candidate.fingerprint}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      selected.push(candidate);
      if (selected.length >= limit) break;
    }

    selected.forEach((candidate, index) => {
      candidate.element.setAttribute(attr, String(index));
      if (attr === "data-alibaba-agent-detail") {
        candidate.element.setAttribute("data-alibaba-agent-detail-label", candidate.label.slice(0, 240));
        candidate.element.setAttribute("data-alibaba-agent-detail-key", candidate.key);
        candidate.element.setAttribute("data-alibaba-agent-detail-fingerprint", candidate.fingerprint);
        candidate.element.setAttribute("data-alibaba-agent-detail-context", normalize([candidate.label, candidate.context].filter(Boolean).join("\n")).slice(0, 3000));
      }
    });

    return selected.length;
  }, { mode, limit, patterns: ALIBABA_PORTAL_CANDIDATE_PATTERN_SOURCES, skipOrderKeys: hints.skipOrderKeys ?? [], readOrders: hints.readOrders ?? {} });
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
      body: JSON.stringify(buildPortalImportPayload(snapshots, portalImportOptions))
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

function resolveBrowserProfile() {
  const explicitUserDataDir = process.env.LAMBENTI_ALIBABA_BROWSER_USER_DATA_DIR;
  const explicitProfileDirectory = process.env.LAMBENTI_ALIBABA_BROWSER_PROFILE_DIRECTORY;
  const preferredProfileNames = process.env.LAMBENTI_ALIBABA_BROWSER_PROFILE_NAME ?? "Work,lambenti.com,team@lambenti.com";

  if (explicitUserDataDir || explicitProfileDirectory) {
    const userData = explicitUserDataDir ?? defaultChromeUserDataDir();
    const profileInfo = readChromeProfileInfo(userData, explicitProfileDirectory ?? preferredProfileNames);
    const defaultProfileControlBlocked = isDefaultChromeUserDataDir(userData)
      && !/^true$/i.test(process.env.LAMBENTI_ALIBABA_ALLOW_DEFAULT_CHROME_PROFILE_CONTROL ?? "");
    if (defaultProfileControlBlocked) {
      return {
        kind: "dedicated-automation-profile",
        userDataDir: path.resolve(projectRoot, process.env.LAMBENTI_ALIBABA_BROWSER_PROFILE_DIR ?? "var/alibaba-chrome-profile"),
        profileDirectory: undefined,
        profileName: "Alibaba automation profile",
        profileEmail: profileInfo?.userName,
        profileGaiaName: profileInfo?.gaiaName,
        requiresExisting: false,
        source: "default-chrome-profile-blocked-dedicated"
      };
    }
    return {
      kind: "chrome-work-profile",
      userDataDir: path.resolve(userData),
      profileDirectory: explicitProfileDirectory,
      profileName: process.env.LAMBENTI_ALIBABA_BROWSER_PROFILE_NAME ?? profileInfo?.name ?? explicitProfileDirectory ?? "Work",
      profileEmail: profileInfo?.userName,
      profileGaiaName: profileInfo?.gaiaName,
      requiresExisting: true,
      source: "explicit-env"
    };
  }

  const useWorkProfile = !/^false$/i.test(process.env.LAMBENTI_ALIBABA_USE_WORK_CHROME_PROFILE ?? "true");
  const chromeUserDataDir = defaultChromeUserDataDir();
  const localStatePath = path.join(chromeUserDataDir, "Local State");
  if (useWorkProfile && fs.existsSync(localStatePath)) {
    try {
      const profile = selectChromeProfileFromLocalState(fs.readFileSync(localStatePath, "utf8"), preferredProfileNames);
      if (profile) {
        return {
          kind: "chrome-work-profile",
          userDataDir: chromeUserDataDir,
          profileDirectory: profile.directory,
          profileName: profile.name || profile.shortcutName || profile.directory,
          profileEmail: profile.userName,
          profileGaiaName: profile.gaiaName,
          requiresExisting: true,
          source: "chrome-local-state"
        };
      }
    } catch (error) {
      if (verbose) console.error(`Could not read Chrome Local State for profile selection: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    kind: "dedicated-automation-profile",
    userDataDir: path.resolve(projectRoot, process.env.LAMBENTI_ALIBABA_BROWSER_PROFILE_DIR ?? "var/alibaba-chrome-profile"),
    profileDirectory: undefined,
    profileName: "Alibaba automation profile",
    profileEmail: undefined,
    requiresExisting: false,
    source: process.env.LAMBENTI_ALIBABA_BROWSER_PROFILE_DIR ? "legacy-env" : "default-dedicated"
  };
}

function readChromeProfileInfo(userDataDir, preference) {
  const localStatePath = path.join(userDataDir, "Local State");
  if (!fs.existsSync(localStatePath)) return null;
  try {
    return selectChromeProfileFromLocalState(fs.readFileSync(localStatePath, "utf8"), preference);
  } catch (error) {
    if (verbose) console.error(`Could not read Chrome Local State profile info: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function isDefaultChromeUserDataDir(candidate) {
  return path.resolve(String(candidate ?? "")).toLowerCase() === path.resolve(defaultChromeUserDataDir()).toLowerCase();
}

function defaultChromeUserDataDir() {
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? "", "AppData", "Local"), "Google", "Chrome", "User Data");
  }
  if (process.platform === "darwin") {
    return path.join(process.env.HOME ?? "", "Library", "Application Support", "Google", "Chrome");
  }
  return path.join(process.env.HOME ?? "", ".config", "google-chrome");
}

function publicBrowserProfile(profile) {
  return {
    kind: profile.kind,
    userDataDir: profile.userDataDir,
    profileDirectory: profile.profileDirectory,
    profileName: profile.profileName,
    profileEmail: profile.profileEmail,
    profileGaiaName: profile.profileGaiaName,
    source: profile.source
  };
}

function formatBrowserProfile(profile) {
  const parts = [profile.profileName, profile.profileEmail, profile.profileDirectory].filter(Boolean);
  return `${profile.kind === "chrome-work-profile" ? "Chrome Work profile" : "dedicated Chrome automation profile"}${parts.length ? ` (${parts.join(" · ")})` : ""}`;
}

function summarizeBrowserLaunchError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Opening in existing browser session/i.test(message)) {
    return "Chrome reported that this profile is already open in an existing browser session.";
  }
  return message.split("\nCall log:")[0].trim();
}

function browserLaunchCanUseManualChromeFallback(message) {
  return browserLaunchFailedBecauseProfileOpen(message)
    || browserLaunchFailedBecauseDefaultProfileRemoteDebugging(message);
}

function openManualChromeProfileUrl(executablePath, profile, url) {
  try {
    const child = spawn(executablePath, buildManualChromeOpenArgs(profile, url), {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    return { opened: true, errors: [] };
  } catch (error) {
    return { opened: false, errors: [`Could not open Chrome manually: ${error instanceof Error ? error.message : String(error)}`] };
  }
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

async function assistAlibabaLogin(page, { allowCredentialPrompt = false } = {}) {
  if (!loginAssistEnabled) return { savedGoogleContinueClicked: false, googleProviderClicked: false, accountConfirmationClicked: false, credentialsSubmitted: false };

  const result = {
    savedGoogleContinueClicked: false,
    googleProviderClicked: false,
    accountConfirmationClicked: false,
    credentialsSubmitted: false
  };

  result.accountConfirmationClicked = await clickAlibabaAccountConfirmation(page, Math.min(accountConfirmTimeoutMs, 1_500));
  if (result.accountConfirmationClicked) return result;

  result.savedGoogleContinueClicked = await clickSavedGoogleContinue(page, googleContinueTimeoutMs);
  if (result.savedGoogleContinueClicked) {
    await page.waitForTimeout(750);
    result.accountConfirmationClicked = await clickAlibabaAccountConfirmation(page, accountConfirmTimeoutMs);
    return result;
  }

  result.googleProviderClicked = await clickAlibabaGoogleProvider(page);
  if (result.googleProviderClicked) {
    await page.waitForTimeout(750);
    result.savedGoogleContinueClicked = await clickSavedGoogleContinue(page, googleContinueTimeoutMs);
    if (result.savedGoogleContinueClicked) {
      await page.waitForTimeout(750);
      result.accountConfirmationClicked = await clickAlibabaAccountConfirmation(page, accountConfirmTimeoutMs);
      return result;
    }
    result.accountConfirmationClicked = await clickAlibabaAccountConfirmation(page, Math.min(accountConfirmTimeoutMs, 2_000));
    if (result.accountConfirmationClicked) return result;
  }

  if (allowCredentialPrompt) {
    result.credentialsSubmitted = await promptAndSubmitAlibabaCredentials(page);
  }

  return result;
}

async function clickAlibabaAccountConfirmation(page, timeoutMs = accountConfirmTimeoutMs) {
  const regexSource = alibabaAccountConfirmRegexSource();
  if (!regexSource) return false;
  if (await clickAlibabaAccountConfirmationDom(page, regexSource, Math.min(timeoutMs, 2_000))) return true;
  const windowsResult = clickAlibabaAccountConfirmationInWindowsChrome(timeoutMs);
  if (windowsResult.clicked) return true;
  return clickAlibabaAccountConfirmationDom(page, regexSource, Math.min(timeoutMs, 2_000));
}

function clickAlibabaAccountConfirmationInWindowsChrome(timeoutMs = accountConfirmTimeoutMs) {
  if (headless || !loginAssistEnabled) return { clicked: false, skipped: true, reason: "disabled-or-headless" };
  const accountRegexSource = alibabaAccountConfirmRegexSource();
  if (!accountRegexSource) return { clicked: false, skipped: true, reason: "no-trusted-account-email" };
  return clickWindowsAlibabaAccountConfirm({
    accountRegexSource,
    timeoutMs
  });
}

function alibabaAccountConfirmRegexSource() {
  const emails = normalizeTrustedAlibabaAccountEmails(
    browserProfile,
    [
      process.env.LAMBENTI_ALIBABA_ACCOUNT_CONFIRM_EMAIL,
      process.env.LAMBENTI_EMAIL_IMAP_USER
    ].filter(Boolean).join(",")
  );
  if (emails.length === 0) return "";
  return buildAlibabaAccountConfirmRegexSource(emails);
}

async function clickAlibabaAccountConfirmationDom(page, regexSource, timeoutMs) {
  const deadline = Date.now() + Math.max(timeoutMs, 250);
  while (Date.now() < deadline) {
    const bodyText = await getBodyText(page);
    if (matchesAlibabaAccountConfirmationText(bodyText, regexSource)) {
      for (const frame of page.frames()) {
        const yesButton = frame.getByRole("button", { name: /^\s*Yes\s*$/i }).first();
        try {
          if (await yesButton.isVisible({ timeout: 250 })) {
            await yesButton.click({ timeout: 1_000 });
            return true;
          }
        } catch {
          // Continue checking frames until timeout.
        }
      }
    }
    await page.waitForTimeout(250);
  }
  return false;
}

async function clickSavedGoogleContinue(page, timeoutMs) {
  const regexSource = savedGoogleContinueRegexSource();
  if (await clickSavedGoogleContinueDom(page, regexSource, Math.min(timeoutMs, 2_000))) return true;
  if (await clickFedCmContinueAccount(page, regexSource, Math.min(timeoutMs, 5_000))) return true;
  const windowsResult = clickSavedGoogleContinueInWindowsChrome(timeoutMs);
  if (windowsResult.clicked) return true;
  return clickSavedGoogleContinueDom(page, regexSource, Math.min(timeoutMs, 2_000));
}

function clickSavedGoogleContinueInWindowsChrome(timeoutMs = googleContinueTimeoutMs) {
  if (headless || !loginAssistEnabled) return { clicked: false, skipped: true, reason: "disabled-or-headless" };
  return clickWindowsUiButtonByRegex({
    regexSource: savedGoogleContinueRegexSource(),
    timeoutMs
  });
}

function savedGoogleContinueRegexSource() {
  const names = normalizeContinueAsNames(browserProfile, process.env.LAMBENTI_ALIBABA_GOOGLE_CONTINUE_NAME ?? browserProfile.profileGaiaName ?? "Musashi");
  return buildSavedGoogleContinueRegexSource(names);
}

async function clickSavedGoogleContinueDom(page, regexSource, timeoutMs) {
  const matcher = new RegExp(regexSource, "i");
  const deadline = Date.now() + Math.max(timeoutMs, 250);
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      for (const role of ["button", "link"]) {
        const locator = frame.getByRole(role, { name: matcher }).first();
        try {
          if (await locator.isVisible({ timeout: 250 })) {
            await locator.click({ timeout: 1_000 });
            return true;
          }
        } catch {
          // Try the next frame/role until the bounded timeout expires.
        }
      }
    }
    await page.waitForTimeout(250);
  }
  return false;
}

async function clickFedCmContinueAccount(page, regexSource, timeoutMs) {
  let client;
  try {
    client = await page.context().newCDPSession(page);
    await client.send("FedCm.enable", { disableRejectionDelay: true }).catch(() => client.send("FedCm.enable"));
    const dialog = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), Math.max(timeoutMs, 250));
      client.on("FedCm.dialogShown", (event) => {
        clearTimeout(timer);
        resolve(event);
      });
    });
    if (!dialog?.dialogId) return false;
    const accounts = Array.isArray(dialog.accounts) ? dialog.accounts : [];
    const accountIndex = Math.max(0, accounts.findIndex((account) => {
      const labels = [account.name, account.givenName, account.email]
        .filter(Boolean)
        .map((value) => `Continue as ${value}`);
      return labels.some((label) => matchesSavedGoogleContinueButtonName(label, regexSource));
    }));
    await client.send("FedCm.selectAccount", { dialogId: dialog.dialogId, accountIndex });
    return true;
  } catch {
    return false;
  } finally {
    await client?.detach?.().catch(() => undefined);
  }
}

async function clickAlibabaGoogleProvider(page) {
  const matcher = /continue\s+with\s+google|sign\s+in\s+with\s+google/i;
  for (const frame of page.frames()) {
    for (const role of ["button", "link"]) {
      const locator = frame.getByRole(role, { name: matcher }).first();
      try {
        if (await locator.isVisible({ timeout: 500 })) {
          await locator.click({ timeout: 2_000 });
          return true;
        }
      } catch {
        // Continue searching other frames/roles.
      }
    }
  }
  return false;
}

async function promptAndSubmitAlibabaCredentials(page) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const email = (await rl.question("Alibaba email address for one-time login fill (blank to continue manually): ")).trim();
  rl.close();
  if (!email) return false;
  const password = await promptHidden("Alibaba password (hidden; not stored or logged): ");
  if (!password) return false;
  return submitProvidedAlibabaCredentials(page, { email, password });
}

async function promptHidden(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") return "";
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    const wasRaw = Boolean(stdin.isRaw);
    let value = "";
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const cleanup = () => {
      stdin.setRawMode(wasRaw);
      stdin.removeListener("data", onData);
      stdin.pause();
    };
    const onData = (chunk) => {
      const text = String(chunk);
      if (text === "\u0003") {
        cleanup();
        reject(new Error("Credential prompt interrupted"));
        return;
      }
      if (text === "\r" || text === "\n") {
        stdout.write("\n");
        cleanup();
        resolve(value);
        return;
      }
      if (text === "\u007f" || text === "\b") {
        value = value.slice(0, -1);
        return;
      }
      value += text;
    };
    stdin.on("data", onData);
  });
}

async function submitProvidedAlibabaCredentials(page, { email, password }) {
  const submittedEmail = await fillAndSubmitAlibabaLoginInput(page, "identity", email);
  if (!submittedEmail) return false;
  await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(1_500);
  let state = await getAlibabaAuthState(page);
  if (state.securityChallengeRequired || !state.loginRequired) return true;

  const submittedPassword = await fillAndSubmitAlibabaLoginInput(page, "password", password);
  if (!submittedPassword) return true;
  await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(loginSettleMs);
  state = await getAlibabaAuthState(page);
  if (state.securityChallengeRequired) {
    throw manualInterventionError("security", "Alibaba showed a CAPTCHA/2FA/security verification check after credential submission. Complete it manually in Chrome; this agent will not bypass it.");
  }
  return true;
}

async function fillAndSubmitAlibabaLoginInput(page, kind, value) {
  for (const frame of page.frames()) {
    const result = await frame.evaluate(({ kind, value }) => {
      const visible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const selectors = kind === "password"
        ? ["input[type='password']", "input[name*='password' i]"]
        : [
            "input[type='email']",
            "input[autocomplete='username']",
            "input[name*='email' i]",
            "input[name*='account' i]",
            "input[name*='login' i]",
            "input[placeholder*='email' i]",
            "input[placeholder*='account' i]",
            "input[type='text']"
          ];
      const inputs = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector))).filter(visible);
      const input = inputs.find((candidate) => !candidate.disabled && !candidate.readOnly);
      if (!input) return { submitted: false };
      input.focus();
      input.value = value;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      input.dispatchEvent(new Event("change", { bubbles: true }));

      const form = input.closest("form");
      const root = form ?? document;
      const controls = Array.from(root.querySelectorAll("button, input[type='submit'], [role='button']")).filter(visible);
      const submit = controls.find((element) => {
        if ((element instanceof HTMLButtonElement || element instanceof HTMLInputElement) && element.disabled) return false;
        const label = [element.textContent, element.getAttribute("aria-label"), element.getAttribute("title"), element.getAttribute("value")].filter(Boolean).join(" ");
        return /continue|next|sign\s*in|log\s*in|submit|登录|登入|下一步/i.test(label);
      }) ?? controls.find((element) => !(element instanceof HTMLButtonElement || element instanceof HTMLInputElement) || !element.disabled);
      if (submit) {
        submit.click();
        return { submitted: true };
      }
      if (form instanceof HTMLFormElement) {
        form.requestSubmit?.();
        return { submitted: true };
      }
      return { submitted: false };
    }, { kind, value }).catch(() => ({ submitted: false }));
    if (result.submitted) return true;
  }
  return false;
}

async function ensureAlibabaAuthenticated(page) {
  let state = await getAlibabaAuthState(page);
  if (state.securityChallengeRequired || !state.loginRequired || !autoSubmitSavedLogin) {
    return { ...state, autoLoginAttempted: false };
  }

  let autoLoginAttempted = false;
  const assistedLogin = await assistAlibabaLogin(page, { allowCredentialPrompt: false });
  if (assistedLogin.savedGoogleContinueClicked || assistedLogin.googleProviderClicked || assistedLogin.accountConfirmationClicked || assistedLogin.credentialsSubmitted) {
    autoLoginAttempted = true;
    await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(loginSettleMs);
    state = await getAlibabaAuthState(page);
    if (state.securityChallengeRequired || !state.loginRequired) return { ...state, autoLoginAttempted };
  }

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
  if (page.isClosed?.()) return { loginRequired: true, securityChallengeRequired: false };
  const url = page.url();
  const text = await getBodyText(page);
  const state = detectAlibabaAuthState({ url, text });
  if (!text.trim() && /login|signin|sign[-_]?in|passport|account\.alibaba/i.test(url)) {
    return { loginRequired: true, securityChallengeRequired: false };
  }
  return state;
}

function manualInterventionError(kind, message) {
  const error = new Error(message);
  error.alibabaManualIntervention = kind;
  return error;
}

function isManualInterventionError(error) {
  return Boolean(error && typeof error === "object" && (error.alibabaManualIntervention === "login" || error.alibabaManualIntervention === "security"));
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
  return looksRelevantCore(text);
}

function extractOrderId(text) {
  return extractOrderIdCore(text);
}

function extractOrderStatus(text) {
  return extractOrderStatusCore(text);
}

function extractSupplierName(text) {
  return extractSupplierNameCore(text);
}

function extractTrackingNumbers(text) {
  return extractTrackingNumbersCore(text);
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
  if (result.message) return result.message;

  const lines = [];
  if (result.configured === false) {
    lines.push("Alibaba portal agent is not configured or could not open Chrome.");
    lines.push(...result.errors);
    return lines.join("\n");
  }

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
  if (result.trackingMemory) {
    lines.push(`Stale-scan memory: remembered ${result.trackingMemory.ordersRemembered} order candidate(s) and ${result.trackingMemory.messageThreadsRemembered} message thread(s); skipped ${result.trackingMemory.orderCandidatesSkippedKnownTracking ?? 0} already-tracked order candidate(s), ${result.trackingMemory.orderCandidatesSkippedWaitingToShip ?? 0} waiting-to-ship candidate(s), ${result.trackingMemory.orderCandidatesSkippedAlreadyChecked ?? 0} already-checked unchanged order candidate(s), and ${result.trackingMemory.messageThreadsSkippedStale ?? 0} unchanged message thread(s).`);
  }
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

function readTrackingCaptureMemory() {
  return normalizeTrackingCaptureMemory(readState().trackingCaptureMemory);
}

function writeTrackingCaptureMemory(memory) {
  const state = readState();
  writeState({
    ...state,
    trackingCaptureMemory: normalizeTrackingCaptureMemory(memory)
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

function readOptionValue(name) {
  const prefix = `${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
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
