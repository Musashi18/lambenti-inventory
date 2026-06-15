import crypto from "node:crypto";

export const ALIBABA_PORTAL_CANDIDATE_PATTERN_SOURCES = Object.freeze({
  invoice: {
    include: "invoice|receipt|download\\s+invoice|commercial\\s+invoice|pdf|发票|收据|下载",
    exclude: sideEffectCandidatePatternSource()
  },
  trackingDetail: {
    include: [
      "view\\s+order",
      "order\\s+detail",
      "details",
      "shipment",
      "shipping",
      "tracking",
      "track\\s+(?:order|package|shipment)",
      "logistics",
      "waybill",
      "订单详情",
      "订单",
      "物流",
      "运单",
      "货运",
      "追踪"
    ].join("|"),
    exclude: sideEffectCandidatePatternSource()
  },
  detail: {
    include: [
      "view\\s+order",
      "order\\s+detail",
      "details",
      "message",
      "message\\s+thread",
      "chat\\s+history",
      "invoice",
      "receipt",
      "payment\\s+details?",
      "paid",
      "shipment",
      "shipping",
      "tracking",
      "track\\s+order",
      "logistics",
      "waybill",
      "trade\\s+assurance",
      "订单详情",
      "订单",
      "消息",
      "聊天记录",
      "发票",
      "收据",
      "付款详情",
      "物流",
      "运单",
      "货运",
      "追踪"
    ].join("|"),
    exclude: sideEffectCandidatePatternSource()
  }
});

export function isSafeAlibabaPortalCandidateText(text, mode = "detail") {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return false;
  const patterns = ALIBABA_PORTAL_CANDIDATE_PATTERN_SOURCES[mode] ?? ALIBABA_PORTAL_CANDIDATE_PATTERN_SOURCES.detail;
  const include = new RegExp(patterns.include, "i");
  const exclude = new RegExp(patterns.exclude, "i");
  return include.test(normalized) && !exclude.test(normalized);
}

export function looksRelevant(text) {
  const normalized = normalizeWhitespace(text);
  return /alibaba|trade assurance|order|invoice|supplier|seller|quantity|total|paid|payment|shipping|shipment|ship\s*out|shipped|tracking|waybill|logistics|message|物流|运单|发票|供应商|卖家|发货/i.test(normalized)
    && /order|invoice|payment|supplier|seller|quantity|total|tracking|waybill|shipment|ship\s*out|shipped|message|物流|运单|发票|订单|消息|发货/i.test(normalized);
}

export function extractOrderId(text) {
  const normalized = String(text ?? "");
  const explicit = normalized.match(/(?:orderId|order_id|orderNumber|order_number)[=:/#-]?\s*([0-9]{10,24})/i)
    ?? normalized.match(/(?:order\s*(?:id|no\.?|number|#)|trade\s+assurance\s+order|订单(?:编号|号)?|订单\s*ID)\s*[:.#=-]?\s*([0-9]{10,24})/i);
  if (explicit?.[1]) return explicit[1];

  const lines = normalized.split(/\r?\n/);
  for (const line of lines) {
    if (!/(?:order|trade\s+assurance|订单)/i.test(line)) continue;
    if (/(?:tracking|waybill|shipment|logistics|运单|物流|快递|追踪)/i.test(line)) continue;
    const candidate = line.match(/\b([0-9]{10,24})\b/);
    if (candidate?.[1]) return candidate[1];
  }

  return undefined;
}

export function extractSupplierName(text) {
  const normalized = String(text ?? "");
  const match = normalized.match(/(?:supplier|seller|store|company|供应商|卖家|店铺|公司)\s*[:#：-]?\s*([^\n|;；]{2,100})/i)
    ?? normalized.match(/supplier\s+(.+?)\s+has received/i);
  return cleanLabelValue(match?.[1]);
}

export function extractOrderStatus(text) {
  const normalized = String(text ?? "");
  const match = normalized.match(/(?:status|order\s+status|状态|订单状态)\s*[:#：-]?\s*(completed|complete|delivered|shipped|closed|finished|已完成|已发货|已送达)/i)
    ?? normalized.match(/\b(completed|complete|delivered|shipped|closed|finished)\b/i);
  return cleanLabelValue(match?.[1]);
}

export function extractPortalEvidenceDate(text) {
  const normalized = String(text ?? "");
  const labelPatterns = [
    /(?:order\s*date|ordered\s*on|placed\s*on|created\s*on|created\s*at|completed\s*on|complete\s*date|delivered\s*on|delivery\s*date|shipped\s*on|shipping\s*date|paid\s*on|付款时间|下单时间|订单时间|完成时间|发货时间|送达时间)\s*[:#：-]?\s*([^\n\r]{6,60})/ig,
    /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s*\d{4})\b/ig,
    /\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2})\b/g
  ];

  for (const pattern of labelPatterns) {
    pattern.lastIndex = 0;
    for (const match of normalized.matchAll(pattern)) {
      const parsed = parsePortalDate(match[1]);
      if (parsed) return parsed;
    }
  }
  return undefined;
}

export function isRecentPortalEvidence(text, { now = new Date(), months = 3 } = {}) {
  const evidenceDate = extractPortalEvidenceDate(text);
  if (!evidenceDate) return true;
  return evidenceDate >= subtractMonths(now, months);
}

const SHIPPING_TRACKING_MESSAGE_REGEX = /(?:\b(?:tracking|track|shipment|shipping|ship\s*out|will\s+ship|shipped|logistics|waybill|carrier|delivered|delivery|eta|in\s+transit|package|parcel|dispatch|freight|customs)\b|运单|物流|快递|追踪|发货|送达)/i;

export function hasShippingTrackingMessageContext(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return false;
  return SHIPPING_TRACKING_MESSAGE_REGEX.test(normalized) || extractTrackingNumbers(normalized).length > 0;
}

export function extractConversationContext(text, { maxLines = 40, contextRadius = 2 } = {}) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .filter((line) => !looksLikeComposerOrSendUi(line));
  const includeIndexes = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    if (!hasShippingTrackingMessageContext(lines[index])) continue;
    for (let offset = -contextRadius; offset <= contextRadius; offset += 1) {
      const candidateIndex = index + offset;
      if (candidateIndex >= 0 && candidateIndex < lines.length) includeIndexes.add(candidateIndex);
    }
  }

  const important = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!includeIndexes.has(index)) continue;
    const line = lines[index];
    if (!important.includes(line)) important.push(line);
    if (important.length >= maxLines) break;
  }

  return important.join("\n");
}

export function extractTrackingNumbers(text) {
  const normalized = String(text ?? "");
  const matches = [];
  const labeledPatterns = [
    /(?:tracking|waybill|shipment|logistics)\s*(?:no\.?|number|#|id)?\s*[:#：-]\s*([^\n\r]{6,80})/i,
    /(?:tracking|waybill|shipment|logistics)\s+(?:no\.?|number|id)\s+([^\n\r]{6,80})/i,
    /(?:运单号?|物流单号?|快递单号?|追踪号?)\s*[:#：-]?\s*([^\n\r]{6,80})/i
  ];

  for (const rawLine of normalized.split(/\r?\n/)) {
    const line = normalizeWhitespace(rawLine);
    if (!/(tracking|waybill|shipment|logistics|carrier|UPS|FedEx|DHL|USPS|Canada Post|YunExpress|Yanwen|4PX|运单|物流|快递|追踪)/i.test(line)) continue;
    if (/(?:order\s*(?:id|no\.?|number|#)|订单(?:编号|号)?)/i.test(line) && !/(tracking|waybill|运单|物流)/i.test(line)) continue;

    const labeled = labeledPatterns.map((pattern) => line.match(pattern)).find((match) => match?.[1]);
    if (labeled?.[1]) {
      addTrackingCandidate(matches, labeled[1]);
      if (matches.length >= 8) return matches;
    }

    const knownMatches = [
      ...line.matchAll(/\b1Z[0-9A-Z]{16}\b/gi),
      ...line.matchAll(/\b[A-Z]{1,4}\d{9,22}[A-Z]{0,4}\b/gi),
      ...line.matchAll(/\b\d{12,22}\b/g)
    ];
    for (const match of knownMatches) {
      addTrackingCandidate(matches, withCarrierPrefix(line, match[0]));
      if (matches.length >= 8) return matches;
    }
  }

  return matches;
}

export function buildPortalMessageId({ orderId, sourceUrl = "", text = "" } = {}) {
  if (orderId) return `<alibaba-portal:${orderId}>`;
  const extractedOrderId = extractOrderId(`${sourceUrl}\n${text}`);
  if (extractedOrderId) return `<alibaba-portal:${extractedOrderId}>`;
  const digest = crypto.createHash("sha256").update(`${sourceUrl}\n${normalizeWhitespace(text).slice(0, 20_000)}`).digest("hex").slice(0, 16);
  return `<alibaba-portal:message:${digest}>`;
}

function sideEffectCandidatePatternSource() {
  return [
    "pay\\s+now",
    "place\\s+order",
    "buy\\s+now",
    "add\\s+to\\s+cart",
    "cancel\\s+order",
    "delete",
    "remove",
    "refund",
    "dispute",
    "sign\\s*out",
    "log\\s*out",
    "confirm\\s+(?:receipt|received|delivery|order)",
    "mark\\s+as\\s+received",
    "release\\s+payment",
    "submit",
    "reply",
    "write\\s+(?:a\\s+)?message",
    "new\\s+message",
    "send\\s+message",
    "send\\s+inquiry",
    "send\\b",
    "chat\\s+now",
    "contact\\s+supplier",
    "付款",
    "支付",
    "下单",
    "购买",
    "加入购物车",
    "取消订单",
    "确认收货",
    "确认收到",
    "确认订单",
    "删除",
    "移除",
    "退款",
    "争议",
    "提交",
    "回复",
    "发送",
    "联系供应商",
    "退出"
  ].join("|");
}

function looksLikeComposerOrSendUi(line) {
  return /^(?:send|reply|submit|chat now|contact supplier)$/i.test(line)
    || /(?:type\s+a\s+message|write\s+a\s+message|enter\s+message|message input|emoji|attach(?:ment)?|send\s+message|send\s+inquiry|reply\s+to\s+supplier)/i.test(line)
    || /(?:输入消息|发送|回复|表情|附件)/i.test(line);
}

function parsePortalDate(value) {
  if (!value) return undefined;
  const cleaned = String(value)
    .replace(/\b(?:PST|PDT|UTC|GMT|CST|EST|EDT|AM|PM)\b.*$/i, "")
    .replace(/[.,;，。；]+$/g, "")
    .trim();
  const iso = cleaned.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) return safeUtcDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const monthName = cleaned.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),\s*(20\d{2})\b/i);
  if (monthName) return safeUtcDate(Number(monthName[3]), monthIndex(monthName[1]), Number(monthName[2]));
  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function safeUtcDate(year, month, day) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return undefined;
  if (month < 0 || month > 11 || day < 1 || day > 31) return undefined;
  return new Date(Date.UTC(year, month, day));
}

function monthIndex(value) {
  const short = String(value ?? "").slice(0, 3).toLowerCase();
  return ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(short);
}

function subtractMonths(now, months) {
  const result = new Date(now);
  result.setUTCMonth(result.getUTCMonth() - Math.max(0, Number(months) || 0));
  return result;
}

function addTrackingCandidate(matches, rawValue) {
  const cleaned = normalizeTrackingCandidate(rawValue);
  if (!cleaned) return;
  if (looksLikeOrderOnlyCandidate(cleaned)) return;
  if (!matches.includes(cleaned)) matches.push(cleaned);
}

function normalizeTrackingCandidate(rawValue) {
  let value = normalizeWhitespace(rawValue)
    .replace(/^(?:number|no\.?|#|:|：|-)+\s*/i, "")
    .replace(/[.,;:，。；：]+$/g, "")
    .trim();

  const explicit = value.match(/\b(?:UPS\s*)?1Z[0-9A-Z]{16}\b/i)
    ?? value.match(/\b(?:FedEx|DHL|USPS|Canada Post|YunExpress|Yanwen|4PX)?\s*[A-Z]{1,4}\d{9,22}[A-Z]{0,4}\b/i)
    ?? value.match(/\b(?:FedEx|DHL|USPS|Canada Post|YunExpress|Yanwen|4PX)\s*\d{10,22}\b/i)
    ?? value.match(/\b\d{12,22}\b/);

  if (!explicit?.[0]) return undefined;
  value = explicit[0];
  value = value.replace(/\s{2,}/g, " ").trim();
  return value.length >= 8 && value.length <= 64 ? value : undefined;
}

function withCarrierPrefix(line, trackingNumber) {
  const carrier = line.match(/\b(UPS|FedEx|DHL|USPS|Canada Post|YunExpress|Yanwen|4PX)\b/i)?.[1];
  if (!carrier) return trackingNumber;
  if (new RegExp(`^${escapeRegExp(carrier)}\\b`, "i").test(trackingNumber)) return trackingNumber;
  return `${carrier} ${trackingNumber}`;
}

function looksLikeOrderOnlyCandidate(value) {
  return /^30\d{10,22}$/.test(value.replace(/\s/g, ""));
}

function cleanLabelValue(value) {
  if (!value) return undefined;
  return normalizeWhitespace(value)
    .replace(/\s{2,}/g, " ")
    .replace(/[;:，。；：]+$/g, "")
    .trim() || undefined;
}

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/[\t\u00a0]+/g, " ").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
