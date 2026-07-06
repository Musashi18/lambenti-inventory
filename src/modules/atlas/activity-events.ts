import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AtlasActivityCategory, AtlasActivityEvent, AtlasLeverageTier } from "./types";

type FounderOsActivityBlock = {
  period?: string;
  label?: string;
  start?: string;
  end?: string;
  category?: string;
  leverage?: string;
  confidence?: number;
  depth?: string;
  hours?: number;
  minutes?: number;
  shipping_proximity?: number;
  top_signals?: string[];
  artifact_types?: string[];
  file_examples?: string[];
  git_dirty_repos?: string[];
  top_apps?: string[];
  top_domains?: string[];
};

const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_ACTIVITY_BLOCKS_PATH = join(homedir(), "AppData", "Local", "hermes", "profiles", "lambenti", "founder_os", "activity_blocks.jsonl");

export async function loadAtlasActivityEvents(input: { now?: Date; blocksPath?: string; lookbackDays?: number } = {}): Promise<AtlasActivityEvent[]> {
  const blocksPath = input.blocksPath ?? process.env.LAMBENTI_FOUNDER_OS_ACTIVITY_BLOCKS_PATH ?? DEFAULT_ACTIVITY_BLOCKS_PATH;
  let text = "";
  try {
    text = await readFile(blocksPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    return [];
  }
  return parseFounderOsActivityBlocks(text, {
    now: input.now ?? new Date(),
    blocksPath,
    lookbackDays: input.lookbackDays ?? DEFAULT_LOOKBACK_DAYS
  });
}

export function parseFounderOsActivityBlocks(text: string, input: { now: Date; blocksPath?: string; lookbackDays?: number }): AtlasActivityEvent[] {
  const blocks = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseJsonLine)
    .filter(isFounderOsActivityBlock);

  if (blocks.length === 0) return [];

  const selectedPeriod = selectBestPeriod(blocks, input.now, input.lookbackDays ?? DEFAULT_LOOKBACK_DAYS);
  const deduped = new Map<string, FounderOsActivityBlock>();
  for (const block of selectedPeriod) {
    const key = [block.start, block.end, block.category, block.leverage, block.depth].join("|");
    deduped.set(key, block);
  }

  return Array.from(deduped.values())
    .map((block, index) => toAtlasActivityEvent(block, index, input.blocksPath ?? "founder_os/activity_blocks.jsonl"))
    .filter((event): event is AtlasActivityEvent => event !== null)
    .sort((left, right) => new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime());
}

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return null;
  }
}

function isFounderOsActivityBlock(value: unknown): value is FounderOsActivityBlock {
  if (!value || typeof value !== "object") return false;
  const candidate = value as FounderOsActivityBlock;
  return typeof candidate.start === "string" && typeof candidate.end === "string";
}

function selectBestPeriod(blocks: FounderOsActivityBlock[], now: Date, lookbackDays: number) {
  const cutoff = now.getTime() - lookbackDays * 24 * 3_600_000;
  const recentBlocks = blocks.filter((block) => {
    const endMs = block.end ? new Date(block.end).getTime() : Number.NaN;
    return Number.isFinite(endMs) && endMs >= cutoff && endMs <= now.getTime() + 3_600_000;
  });
  const source = recentBlocks.length > 0 ? recentBlocks : blocks;
  const weekly = latestPeriod(source.filter((block) => block.period === "weekly"));
  const daily = latestPeriod(source.filter((block) => block.period === "daily"));
  if (weekly.length > 0) {
    if (daily.length > 0 && shouldMergeDailyIntoWeekly(daily, weekly, now)) return [...weekly, ...daily];
    return weekly;
  }
  if (daily.length > 0) return daily;
  return source;
}

function shouldMergeDailyIntoWeekly(daily: FounderOsActivityBlock[], weekly: FounderOsActivityBlock[], now: Date) {
  const latestDailyEnd = latestEndMs(daily);
  const latestWeeklyEnd = latestEndMs(weekly);
  if (latestDailyEnd > latestWeeklyEnd) return true;
  const dailyLabel = daily
    .map((block) => block.label)
    .filter((label): label is string => Boolean(label))
    .sort()
    .at(-1);
  return dailyLabel === atlasDayKey(now) && latestDailyEnd >= latestWeeklyEnd;
}

function latestEndMs(blocks: FounderOsActivityBlock[]) {
  return Math.max(0, ...blocks.map((block) => new Date(block.end ?? "").getTime()).filter(Number.isFinite));
}

function atlasDayKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function latestPeriod(blocks: FounderOsActivityBlock[]) {
  const latestLabel = blocks
    .map((block) => block.label)
    .filter((label): label is string => Boolean(label))
    .sort()
    .at(-1);
  return latestLabel ? blocks.filter((block) => block.label === latestLabel) : blocks;
}

function toAtlasActivityEvent(block: FounderOsActivityBlock, index: number, blocksPath: string): AtlasActivityEvent | null {
  const startedAt = block.start ? new Date(block.start) : null;
  const endedAt = block.end ? new Date(block.end) : null;
  if (!startedAt || !endedAt || !Number.isFinite(startedAt.getTime()) || !Number.isFinite(endedAt.getTime()) || endedAt <= startedAt) return null;

  const category = normalizeCategory(block.category);
  const leverageTier = normalizeLeverage(block.leverage);
  const confidencePct = normalizeConfidence(block.confidence);
  const evidenceSignals = compactStrings([...(block.top_signals ?? []), ...(block.artifact_types ?? []), ...(block.file_examples ?? [])]);
  const validatedActivity = isValidatedActivityBlock({ block, category, leverageTier, confidencePct, evidenceSignals });
  const nodeId = inferNodeId(block, category);

  return {
    id: stableActivityId(block, index),
    nodeId,
    category,
    leverageTier,
    confidencePct,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationHours: blockDurationHours(block, startedAt, endedAt),
    summary: summarizeBlock(block, category, leverageTier),
    sourceType: "FILE",
    sourceRef: blocksPath,
    validatedProgress: validatedActivity
  };
}

function blockDurationHours(block: FounderOsActivityBlock, startedAt: Date, endedAt: Date) {
  if (Number.isFinite(block.hours) && Number(block.hours) >= 0) return Math.round(Number(block.hours) * 100) / 100;
  if (Number.isFinite(block.minutes) && Number(block.minutes) >= 0) return Math.round((Number(block.minutes) / 60) * 100) / 100;
  return Math.round(((endedAt.getTime() - startedAt.getTime()) / 3_600_000) * 100) / 100;
}

function normalizeCategory(category: string | undefined): AtlasActivityCategory {
  const normalized = (category ?? "Unknown").trim();
  switch (normalized) {
    case "Engineering":
    case "Firmware":
    case "Industrial Design":
    case "Manufacturing":
    case "Supplier Communication":
    case "Marketing":
    case "Content Creation":
    case "Finance":
    case "Planning":
    case "Research":
    case "Learning":
    case "Administration":
    case "Meetings":
    case "Customer Development":
    case "Distraction":
      return normalized as AtlasActivityCategory;
    case "Business Strategy":
      return "Planning";
    case "Electronics":
      return "Engineering";
    default:
      return "Unknown";
  }
}

function normalizeLeverage(leverage: string | undefined): AtlasLeverageTier {
  switch ((leverage ?? "UNKNOWN").trim().toUpperCase()) {
    case "HIGH":
      return "HIGH";
    case "MEDIUM":
      return "MEDIUM";
    case "LOW":
      return "LOW";
    default:
      return "UNKNOWN";
  }
}

function normalizeConfidence(confidence: number | undefined) {
  if (!Number.isFinite(confidence)) return 25;
  const value = Number(confidence);
  return Math.max(0, Math.min(100, Math.round(value <= 1 ? value * 100 : value)));
}

function isValidatedActivityBlock(input: {
  block: FounderOsActivityBlock;
  category: AtlasActivityCategory;
  leverageTier: AtlasLeverageTier;
  confidencePct: number;
  evidenceSignals: string[];
}) {
  if (input.category === "Unknown" || input.category === "Distraction") return false;
  if (input.leverageTier !== "HIGH") return false;
  if (input.confidencePct < 55) return false;
  if ((input.block.depth ?? "").toLowerCase() === "idle") return false;
  if ((input.block.hours ?? 0) <= 0 && (input.block.minutes ?? 0) <= 0) return false;
  return input.evidenceSignals.length > 0 || (input.block.git_dirty_repos ?? []).length > 0;
}

function inferNodeId(block: FounderOsActivityBlock, category: AtlasActivityCategory) {
  const haystack = compactStrings([category, ...(block.top_signals ?? []), ...(block.artifact_types ?? []), ...(block.file_examples ?? [])]).join(" ").toLowerCase();
  if (category === "Firmware" || /firmware|\.ino|arduino/.test(haystack)) return "engineering.firmware";
  if (/electronics|pcb|schematic|magnetometer|sensor/.test(haystack)) return "engineering.electronics";
  if (category === "Supplier Communication" || /supplier|quote|alibaba|purchase/.test(haystack)) return "manufacturing.supplier-qualification";
  if (category === "Manufacturing" || /qa|test jig|manufacturing|production/.test(haystack)) return "manufacturing.qa";
  if (category === "Finance" || /accounting|invoice|landed cost|cash/.test(haystack)) return "finance.cash-runway";
  if (category === "Marketing" || category === "Content Creation" || /website|brand|marketing|content/.test(haystack)) return "brand.website";
  return undefined;
}

function summarizeBlock(block: FounderOsActivityBlock, category: AtlasActivityCategory, leverageTier: AtlasLeverageTier) {
  const hours = Number.isFinite(block.hours) ? Number(block.hours).toFixed(2) : ((block.minutes ?? 0) / 60).toFixed(2);
  const signals = compactStrings(block.top_signals ?? []).slice(0, 2).join("; ");
  return `${hours}h ${category} activity classified as ${leverageTier.toLowerCase()} leverage${signals ? ` (${signals})` : ""}.`;
}

function stableActivityId(block: FounderOsActivityBlock, index: number) {
  const raw = [block.period, block.label, block.start, block.end, block.category, block.leverage, index].join(":");
  return `founder-os:${raw.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 160)}`;
}

function compactStrings(values: string[]) {
  return values.map((value) => String(value ?? "").trim()).filter(Boolean);
}
