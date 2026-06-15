#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

export function parseTrackingRefreshArgs(argv = process.argv.slice(2)) {
  const options = { verbose: false, jsonOnly: false, limit: 25, agentId: "tracking-refresh-scheduler" };
  for (const arg of argv) {
    if (arg === "--verbose" || arg === "-v") options.verbose = true;
    else if (arg === "--json") options.jsonOnly = true;
    else if (arg.startsWith("--limit=")) options.limit = positiveInt(arg.slice("--limit=".length), options.limit);
    else if (arg.startsWith("--agent-id=")) options.agentId = arg.slice("--agent-id=".length).trim() || options.agentId;
    else if (arg.startsWith("--base-url=")) options.baseUrl = arg.slice("--base-url=".length).trim();
  }
  return options;
}

export function shouldAttemptTrackingRefresh(env) {
  const provider = blankToUndefined(env.LAMBENTI_TRACKING_STATUS_PROVIDER)?.toUpperCase();
  if (provider === "SHIP24") return Boolean(blankToUndefined(env.LAMBENTI_TRACKING_STATUS_AUTH_TOKEN));
  return Boolean(blankToUndefined(env.LAMBENTI_TRACKING_STATUS_URL_TEMPLATE));
}

export function buildTrackingRefreshRequest({ baseUrl, limit, agentId, secret }) {
  const normalizedBaseUrl = String(baseUrl || "http://127.0.0.1:5173").replace(/\/$/, "");
  const headers = {
    "content-type": "application/json",
    "x-lambenti-agent-id": agentId || "tracking-refresh-scheduler"
  };
  if (secret) headers.authorization = `Bearer ${secret}`;
  return {
    url: `${normalizedBaseUrl}/api/tracking/refresh`,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({ dueOnly: true, limit: positiveInt(limit, 25) })
    }
  };
}

export function shouldNotifyTrackingRefresh(result, options) {
  if (options.jsonOnly || options.verbose) return true;
  return Number(result.refreshed ?? 0) > 0 || Number(result.failed ?? 0) > 0;
}

export function formatTrackingRefreshNotification(result, baseUrl) {
  const normalizedBaseUrl = String(baseUrl || "http://127.0.0.1:5173").replace(/\/$/, "");
  return [
    `Tracking refresh checked ${result.scanned ?? 0} due number(s); refreshed ${result.refreshed ?? 0}, failed ${result.failed ?? 0}, skipped ${result.skipped ?? 0}.`,
    `Review tracking workbench: ${normalizedBaseUrl}/tracking`,
    "Tracking refresh updates shipment metadata only; it does not receive stock or confirm delivery."
  ].join("\n");
}

export async function runTrackingRefresh({ env = process.env, options = parseTrackingRefreshArgs(), fetcher = fetch } = {}) {
  const baseUrl = (options.baseUrl || env.LAMBENTI_INVENTORY_BASE_URL || "http://127.0.0.1:5173").replace(/\/$/, "");
  const providerConfigured = shouldAttemptTrackingRefresh(env);
  if (!providerConfigured) {
    return {
      configured: false,
      skipped: true,
      reason: trackingConfigurationMessage(env),
      trackingUrl: `${baseUrl}/tracking`
    };
  }

  const secret = blankToUndefined(env.LAMBENTI_TRACKING_AGENT_SECRET)
    ?? blankToUndefined(env.LAMBENTI_ALIBABA_AGENT_SECRET)
    ?? blankToUndefined(env.LAMBENTI_EMAIL_SYNC_SECRET);
  const request = buildTrackingRefreshRequest({ baseUrl, limit: options.limit, agentId: options.agentId, secret });
  let response;
  try {
    response = await fetcher(request.url, request.init);
  } catch (error) {
    throw new Error(`could not reach inventory app at ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }

  let body;
  try {
    body = await response.json();
  } catch {
    body = { error: `HTTP ${response.status} ${response.statusText}` };
  }
  if (!response.ok) {
    const detail = Array.isArray(body.errors) ? body.errors.join("; ") : body.error ?? response.statusText;
    throw new Error(`tracking refresh endpoint returned HTTP ${response.status}: ${detail}`);
  }
  return { configured: providerConfigured, skipped: false, ...body, trackingUrl: `${baseUrl}/tracking` };
}

export function loadDotEnv(filePath = path.join(projectRoot, ".env")) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

function blankToUndefined(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function trackingConfigurationMessage(env) {
  const provider = blankToUndefined(env.LAMBENTI_TRACKING_STATUS_PROVIDER)?.toUpperCase();
  if (provider === "SHIP24") return "Set LAMBENTI_TRACKING_STATUS_AUTH_TOKEN to enable scheduled Ship24 tracking refresh.";
  return "Set LAMBENTI_TRACKING_STATUS_URL_TEMPLATE before enabling scheduled tracking refresh.";
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

async function main() {
  loadDotEnv();
  const options = parseTrackingRefreshArgs();
  try {
    const result = await runTrackingRefresh({ options });
    if (options.jsonOnly) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (result.skipped) {
      if (options.verbose) console.log(`${result.reason}\nReview tracking workbench: ${result.trackingUrl}`);
      return;
    }
    if (shouldNotifyTrackingRefresh(result, options)) {
      console.log(formatTrackingRefreshNotification(result, result.trackingUrl.replace(/\/tracking$/, "")));
    }
  } catch (error) {
    console.log(`Tracking refresh agent failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
