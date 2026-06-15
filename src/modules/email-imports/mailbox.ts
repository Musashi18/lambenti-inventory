import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { recognizeImageText } from "@/modules/documents/ocr";
import {
  captureManualTrackingNumbers,
  captureTrackingNumbersFromImports,
  extractManualTrackingNumbersFromText
} from "@/modules/tracking/service";
import { runAlibabaPortalTrackingCapture } from "@/modules/tracking/alibaba-capture-agent";
import { importAlibabaEmailOrder } from "./alibaba-email";

export type OcrImageTextInput = {
  content: Buffer;
  contentType: string;
  filename: string;
};

export type SourceToImportTextOptions = {
  ocrImageText?: (input: OcrImageTextInput) => Promise<string | null | undefined>;
};

type MailboxConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  mailbox: string;
  maxMessages: number;
  maxSourceBytes: number;
  autoApply: boolean;
  autoCreateInvoice: boolean;
  markSeen: boolean;
};

export type MailboxSyncResult = {
  configured: boolean;
  mailbox?: string;
  searchedMessages: number;
  fetchedMessages: number;
  imported: number;
  duplicates: number;
  appliedOrAlreadyApplied: number;
  invoicesCreatedOrUpdated: number;
  trackingSaved: number;
  trackingUpdated: number;
  shipmentConfirmations: number;
  portalCaptureTargetUrls: number;
  portalCapturedSnapshots: number;
  portalTrackingImported: number;
  portalTrackingDuplicates: number;
  needsReview: number;
  skipped: number;
  errors: string[];
  retryQueued?: boolean;
  retryAttempt?: number;
  nextRetryAt?: string;
  retryStatus?: "idle" | "running" | "waiting" | "exhausted";
};

const RETRY_DELAYS_MS = [10_000, 30_000, 90_000, 300_000];

type RetryState = {
  status: "idle" | "running" | "waiting" | "exhausted";
  attempt: number;
  nextRetryAt?: Date;
  timer?: NodeJS.Timeout;
  lastResult?: MailboxSyncResult;
};

const retryState: RetryState = {
  status: "idle",
  attempt: 0
};

export function getAlibabaMailboxConfigStatus() {
  const missing = [
    ["LAMBENTI_EMAIL_IMAP_HOST", process.env.LAMBENTI_EMAIL_IMAP_HOST],
    ["LAMBENTI_EMAIL_IMAP_USER", process.env.LAMBENTI_EMAIL_IMAP_USER],
    ["LAMBENTI_EMAIL_IMAP_PASSWORD", process.env.LAMBENTI_EMAIL_IMAP_PASSWORD]
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  return {
    configured: missing.length === 0,
    missing,
    host: process.env.LAMBENTI_EMAIL_IMAP_HOST,
    user: process.env.LAMBENTI_EMAIL_IMAP_USER,
    mailbox: process.env.LAMBENTI_EMAIL_IMAP_MAILBOX ?? "INBOX",
    autoApply: process.env.LAMBENTI_EMAIL_AUTO_APPLY !== "false",
    autoCreateInvoice: process.env.LAMBENTI_EMAIL_AUTO_CREATE_INVOICE !== "false",
    markSeen: process.env.LAMBENTI_EMAIL_MARK_IMPORTED_SEEN === "true",
    retry: getMailboxRetryStatus()
  };
}

export function getMailboxRetryStatus() {
  return {
    status: retryState.status,
    attempt: retryState.attempt,
    nextRetryAt: retryState.nextRetryAt?.toISOString(),
    lastResult: retryState.lastResult
  };
}

export async function syncAlibabaMailboxWithBackoff(actorId = "mailbox-automation"): Promise<MailboxSyncResult> {
  const now = new Date();

  if (retryState.status === "waiting" && retryState.nextRetryAt && retryState.nextRetryAt > now) {
    return withRetryMetadata(emptyQueuedResult("Sync is queued for retry."));
  }

  if (retryState.status === "running") {
    return withRetryMetadata(emptyQueuedResult("Sync is already running; queued for retry instead of starting another immediate retry."));
  }

  return runSyncAndScheduleBackoff(actorId);
}

export async function syncAlibabaMailbox(actorId = "mailbox-automation"): Promise<MailboxSyncResult> {
  const config = getMailboxConfig();
  if (!config) {
    return {
      configured: false,
      searchedMessages: 0,
      fetchedMessages: 0,
      imported: 0,
      duplicates: 0,
      appliedOrAlreadyApplied: 0,
      invoicesCreatedOrUpdated: 0,
      trackingSaved: 0,
      trackingUpdated: 0,
      shipmentConfirmations: 0,
      portalCaptureTargetUrls: 0,
      portalCapturedSnapshots: 0,
      portalTrackingImported: 0,
      portalTrackingDuplicates: 0,
      needsReview: 0,
      skipped: 0,
      errors: ["Mailbox is not configured. Set LAMBENTI_EMAIL_IMAP_HOST, LAMBENTI_EMAIL_IMAP_USER, and LAMBENTI_EMAIL_IMAP_PASSWORD in .env."]
    };
  }

  const result: MailboxSyncResult = {
    configured: true,
    mailbox: config.mailbox,
    searchedMessages: 0,
    fetchedMessages: 0,
    imported: 0,
    duplicates: 0,
    appliedOrAlreadyApplied: 0,
    invoicesCreatedOrUpdated: 0,
    trackingSaved: 0,
    trackingUpdated: 0,
    shipmentConfirmations: 0,
    portalCaptureTargetUrls: 0,
    portalCapturedSnapshots: 0,
    portalTrackingImported: 0,
    portalTrackingDuplicates: 0,
    needsReview: 0,
    skipped: 0,
    errors: []
  };

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password
    },
    logger: false,
    clientInfo: {
      name: "Lambenti Inventory",
      vendor: "Lambenti"
    },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 120_000
  });

  client.on("error", (error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (!result.errors.includes(message)) result.errors.push(message);
  });

  await client.connect();
  const lock = await client.getMailboxLock(config.mailbox);

  const relevantMessages: string[] = [];
  const alibabaShipmentTargetUrls: string[] = [];

  try {
    // Fetch the latest messages by sequence number instead of using full-text IMAP search.
    // Gmail can time out on broad body searches; local filtering is more reliable for this small ops mailbox.
    const mailbox = client.mailbox;
    const messageCount = mailbox ? mailbox.exists : 0;
    const start = Math.max(1, messageCount - config.maxMessages + 1);
    const range = messageCount > 0 ? `${start}:*` : [];
    result.searchedMessages = messageCount > 0 ? messageCount - start + 1 : 0;

    const candidateSeqs: number[] = [];

    for await (const message of client.fetch(range, { uid: true, envelope: true, size: true }, { uid: false })) {
      const subject = message.envelope?.subject ?? "";
      const from = message.envelope?.from?.map((address) => address.address ?? address.name ?? "").join(" ") ?? "";
      const candidateText = `${subject} ${from}`;

      if (looksLikeSupplierOrderEnvelope(candidateText)) {
        candidateSeqs.push(message.seq);
      } else {
        result.skipped += 1;
      }
    }

    for await (const message of client.fetch(candidateSeqs, { uid: true, source: { maxLength: config.maxSourceBytes } }, { uid: false })) {
      if (!message.source) {
        result.skipped += 1;
        continue;
      }

      result.fetchedMessages += 1;

      try {
        const importTexts = await sourceToImportTexts(message.source, { ocrImageText: recognizeImageText });
        const relevantImportTexts = importTexts.filter(isSupplierOrderEmailText);

        if (relevantImportTexts.length === 0) {
          result.skipped += 1;
          continue;
        }

        relevantMessages.push(...relevantImportTexts);

        if (config.markSeen) {
          await client.messageFlagsAdd(message.uid, ["\\Seen"], { uid: true });
        }
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  } finally {
    lock.release();
    if (client.usable) {
      try {
        await client.logout();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!result.errors.includes(message)) result.errors.push(message);
      }
    }
  }

  for (const rawText of dedupe(relevantMessages)) {
    try {
      const shipmentTargetUrls = extractAlibabaShipmentTrackingTargetUrls(rawText);
      if (looksLikeShipmentNotificationEmail(rawText)) result.shipmentConfirmations += 1;
      alibabaShipmentTargetUrls.push(...shipmentTargetUrls);

      const imported = await importAlibabaEmailOrder({
        rawText,
        autoApply: config.autoApply,
        autoCreateInvoice: config.autoCreateInvoice,
        actorId
      });

      if (imported.created) {
        result.imported += 1;
      } else {
        result.duplicates += 1;
      }

      if (imported.purchaseOrder) {
        result.appliedOrAlreadyApplied += 1;
      }
      if (imported.invoice) {
        result.invoicesCreatedOrUpdated += 1;
      }
      const trackingCapture = await captureTrackingFromImportedShipmentEmail(rawText, imported, actorId);
      result.trackingSaved += trackingCapture.saved;
      result.trackingUpdated += trackingCapture.updated;
      if (!imported.purchaseOrder && imported.import.status === "NEEDS_REVIEW") {
        result.needsReview += 1;
      }
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  await runTargetedAlibabaShipmentCaptures(alibabaShipmentTargetUrls, actorId, result);

  return result;
}

type ImportedEmailOrderResult = Awaited<ReturnType<typeof importAlibabaEmailOrder>>;

async function captureTrackingFromImportedShipmentEmail(rawText: string, imported: ImportedEmailOrderResult, actorId: string) {
  if (!looksLikeShipmentNotificationEmail(rawText) || extractManualTrackingNumbersFromText(rawText).length === 0) {
    return { saved: 0, updated: 0 };
  }

  const result = await captureManualTrackingNumbers({
    rawText,
    actorId,
    externalOrderId: imported.import.externalOrderId,
    purchaseOrderId: imported.purchaseOrder?.id ?? imported.import.purchaseOrderId,
    supplierName: imported.import.supplierName,
    sourceUrl: imported.import.sourceUrl,
    source: imported.import.source || "SYNCED_EMAIL"
  });
  return { saved: result.saved, updated: result.updated };
}

async function runTargetedAlibabaShipmentCaptures(targetUrls: string[], actorId: string, result: MailboxSyncResult) {
  const uniqueTargetUrls = dedupe(targetUrls);
  result.portalCaptureTargetUrls = uniqueTargetUrls.length;
  if (uniqueTargetUrls.length === 0) return;

  try {
    const portal = await runAlibabaPortalTrackingCapture({ targetUrls: uniqueTargetUrls });
    result.portalCapturedSnapshots += portal.capturedSnapshots;
    result.portalTrackingImported += portal.imported;
    result.portalTrackingDuplicates += portal.duplicates;
    if (portal.errors.length > 0) result.errors.push(...portal.errors);
    if (portal.loginRequired) result.errors.push("Alibaba login required before targeted shipment tracking capture can continue.");
    if (portal.securityChallengeRequired) result.errors.push("Alibaba security/CAPTCHA/2FA check blocked targeted shipment tracking capture; complete it manually and rerun sync.");

    const backfill = await captureTrackingNumbersFromImports({ actorId, limit: 200, recentMonths: 3 });
    result.trackingSaved += backfill.saved;
    result.trackingUpdated += backfill.updated;
  } catch (error) {
    result.errors.push(`Alibaba targeted shipment capture failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function looksLikeShipmentNotificationEmail(rawText: string) {
  return /\b(?:shipped|shipment|shipping|track\s*(?:package|shipment|order)?|tracking|logistics|waybill|carrier|delivery)\b/i.test(rawText);
}

export function extractAlibabaShipmentTrackingTargetUrls(rawText: string) {
  if (!looksLikeShipmentNotificationEmail(rawText)) return [];
  const urls = String(rawText ?? "").match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  return dedupe(urls.map(cleanAlibabaTargetUrl).filter((value): value is string => Boolean(value) && isAlibabaOrderTrackingTargetUrl(value)));
}

function cleanAlibabaTargetUrl(value: string) {
  return String(value ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/[)\],.;]+$/g, "")
    .trim();
}

function isAlibabaOrderTrackingTargetUrl(value: string) {
  try {
    const url = new URL(value);
    if (!/(^|\.)alibaba\.com$/i.test(url.hostname)) return false;
    const targetText = `${url.hostname}${url.pathname}${url.search}`;
    return /(?:order|trade|ta|detail|logistics|tracking|shipment|messenger|message|orderId|tradeOrderId|orderNumber)/i.test(targetText);
  } catch {
    return false;
  }
}

async function runSyncAndScheduleBackoff(actorId: string): Promise<MailboxSyncResult> {
  retryState.status = "running";

  try {
    const result = await syncAlibabaMailbox(actorId);
    retryState.lastResult = result;

    if (isTransientMailboxFailure(result)) {
      queueNextRetry(actorId, result);
      return withRetryMetadata(result);
    }

    clearBackoff();
    retryState.lastResult = result;
    return withRetryMetadata(result);
  } catch (error) {
    const result: MailboxSyncResult = {
      configured: true,
      searchedMessages: 0,
      fetchedMessages: 0,
      imported: 0,
      duplicates: 0,
      appliedOrAlreadyApplied: 0,
      invoicesCreatedOrUpdated: 0,
      trackingSaved: 0,
      trackingUpdated: 0,
      shipmentConfirmations: 0,
      portalCaptureTargetUrls: 0,
      portalCapturedSnapshots: 0,
      portalTrackingImported: 0,
      portalTrackingDuplicates: 0,
      needsReview: 0,
      skipped: 0,
      errors: [error instanceof Error ? error.message : String(error)]
    };
    retryState.lastResult = result;
    queueNextRetry(actorId, result);
    return withRetryMetadata(result);
  }
}

function queueNextRetry(actorId: string, result: MailboxSyncResult) {
  if (retryState.timer) clearTimeout(retryState.timer);

  const delay = RETRY_DELAYS_MS[retryState.attempt];
  if (delay === undefined) {
    retryState.status = "exhausted";
    retryState.nextRetryAt = undefined;
    retryState.lastResult = {
      ...result,
      retryQueued: true,
      retryAttempt: retryState.attempt,
      retryStatus: "exhausted",
      errors: [...result.errors, "Automatic retries stopped; queued for manual retry."]
    };
    return;
  }

  retryState.attempt += 1;
  retryState.status = "waiting";
  retryState.nextRetryAt = new Date(Date.now() + delay);
  retryState.lastResult = withRetryMetadata(result);
  retryState.timer = setTimeout(() => {
    void runSyncAndScheduleBackoff(actorId);
  }, delay);
  retryState.timer.unref?.();
}

function clearBackoff() {
  if (retryState.timer) clearTimeout(retryState.timer);
  retryState.timer = undefined;
  retryState.status = "idle";
  retryState.attempt = 0;
  retryState.nextRetryAt = undefined;
}

function withRetryMetadata(result: MailboxSyncResult): MailboxSyncResult {
  return {
    ...result,
    retryQueued: retryState.status === "waiting" || retryState.status === "exhausted",
    retryAttempt: retryState.attempt,
    nextRetryAt: retryState.nextRetryAt?.toISOString(),
    retryStatus: retryState.status
  };
}

function emptyQueuedResult(message: string): MailboxSyncResult {
  return {
    configured: true,
    searchedMessages: 0,
    fetchedMessages: 0,
    imported: 0,
    duplicates: 0,
    appliedOrAlreadyApplied: 0,
    invoicesCreatedOrUpdated: 0,
    trackingSaved: 0,
    trackingUpdated: 0,
    shipmentConfirmations: 0,
    portalCaptureTargetUrls: 0,
    portalCapturedSnapshots: 0,
    portalTrackingImported: 0,
    portalTrackingDuplicates: 0,
    needsReview: 0,
    skipped: 0,
    errors: [message]
  };
}

function isTransientMailboxFailure(result: MailboxSyncResult) {
  if (result.errors.length === 0) return false;
  const combined = result.errors.join("\n");
  return /timeout|connection|network|socket|imap|not available|temporar/i.test(combined) || result.fetchedMessages === 0;
}

function getMailboxConfig(): MailboxConfig | null {
  const host = process.env.LAMBENTI_EMAIL_IMAP_HOST;
  const user = process.env.LAMBENTI_EMAIL_IMAP_USER;
  const password = process.env.LAMBENTI_EMAIL_IMAP_PASSWORD;

  if (!host || !user || !password) return null;

  return {
    host,
    port: parsePositiveInt(process.env.LAMBENTI_EMAIL_IMAP_PORT, 993),
    secure: process.env.LAMBENTI_EMAIL_IMAP_SECURE !== "false",
    user,
    password,
    mailbox: process.env.LAMBENTI_EMAIL_IMAP_MAILBOX ?? "INBOX",
    maxMessages: parsePositiveInt(process.env.LAMBENTI_EMAIL_SYNC_MAX_MESSAGES, 25),
    maxSourceBytes: parsePositiveInt(process.env.LAMBENTI_EMAIL_MAX_SOURCE_BYTES, 10_000_000),
    autoApply: process.env.LAMBENTI_EMAIL_AUTO_APPLY !== "false",
    autoCreateInvoice: process.env.LAMBENTI_EMAIL_AUTO_CREATE_INVOICE !== "false",
    markSeen: process.env.LAMBENTI_EMAIL_MARK_IMPORTED_SEEN === "true"
  };
}

export async function sourceToImportTexts(
  source: Buffer,
  optionsOrDepth: SourceToImportTextOptions | number = {},
  depth = 0
): Promise<string[]> {
  const options = typeof optionsOrDepth === "number" ? {} : optionsOrDepth;
  const currentDepth = typeof optionsOrDepth === "number" ? optionsOrDepth : depth;
  if (currentDepth > 2) return [];

  const parsed = await simpleParser(source);
  const headers = [
    ["Subject", parsed.subject],
    ["From", parsed.from?.text],
    ["Message-ID", parsed.messageId],
    ["Date", parsed.date?.toISOString()]
  ]
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}: ${value}`);

  const body = parsed.text ?? stripHtml(typeof parsed.html === "string" ? parsed.html : "") ?? source.toString("utf8");
  const texts = [[...headers, "", body].join("\n")];
  const ocrImageAttachmentSections: string[] = [];

  for (const attachment of parsed.attachments ?? []) {
    const filename = attachment.filename?.toLowerCase() ?? "";
    const contentType = attachment.contentType.toLowerCase();
    const content = attachment.content;

    if (contentType === "message/rfc822" || filename.endsWith(".eml")) {
      texts.push(...(await sourceToImportTexts(content, options, currentDepth + 1)));
      continue;
    }

    if (contentType.startsWith("text/") || filename.endsWith(".txt") || filename.endsWith(".html")) {
      const text = contentType.includes("html") || filename.endsWith(".html") ? stripHtml(content.toString("utf8")) : content.toString("utf8");
      if (text) texts.push(text);
      continue;
    }

    if (isOcrImageAttachment(contentType, filename) && options.ocrImageText) {
      const displayFilename = attachment.filename ?? filename;
      const ocrText = await options.ocrImageText({
        content,
        contentType: attachment.contentType,
        filename: displayFilename
      });
      if (ocrText?.trim()) {
        ocrImageAttachmentSections.push(formatOcrImageAttachmentText(displayFilename, ocrText));
      }
    }
  }

  if (ocrImageAttachmentSections.length > 0) {
    texts[0] = [texts[0], "Graphical image attachment OCR", ...ocrImageAttachmentSections].join("\n\n");
  }

  return texts;
}

function formatOcrImageAttachmentText(filename: string, text: string) {
  return [
    "Product image",
    `Attachment filename: ${filename || "unnamed image"}`,
    text.trim()
  ].join("\n");
}

function isOcrImageAttachment(contentType: string, filename: string) {
  return contentType.startsWith("image/") || /\.(?:png|jpe?g|webp|tiff?|bmp)$/i.test(filename);
}

function stripHtml(html: string) {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text.length > 0 ? text : undefined;
}

function looksLikeSupplierOrderEnvelope(value: string) {
  if (/verification code|security code|sign[- ]?in code|login code/i.test(value)) return false;
  return /alibaba|ali\s*baba|order|invoice|receipt|payment|paid|shipping|shipment|supplier|purchase/i.test(value);
}

export function isSupplierOrderEmailText(rawText: string) {
  if (/verification code|security code|sign[- ]?in code|login code/i.test(rawText)) return false;
  const text = rawText.toLowerCase();
  const hasOrderIntent = /order\s*(id|no|number|#)|purchase\s+order|invoice|receipt|payment|paid|amount\s+paid|initial\s+payment|shipping|shipment|your order/i.test(rawText);
  const hasSupplierOrCommerceEvidence = /supplier|seller|vendor|factory|from:|unit\s*price|quantity|qty\b|sku|model|part|product|item subtotal|subtotal|total\s*[:#-]?\s*(?:usd|cad|cny|rmb|us\$|cn¥|\$|¥)?\s*[0-9]/i.test(rawText);
  const isKnownSupplierPortal = /alibaba|ali\s*baba/i.test(text);
  return hasOrderIntent && (hasSupplierOrCommerceEvidence || isKnownSupplierPortal);
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function dedupe(values: string[]) {
  return Array.from(new Set(values));
}
