import { prisma } from "@/lib/prisma";
import { loadAtlasActivityEvents } from "./activity-events";
import { summarizeMomentum } from "./scoring";
import type { AtlasActivityEvent, AtlasMomentumSummary, AtlasWeeklyWorkHours } from "./types";

const FOUNDER_OS_TIMEZONE = "America/Toronto";
const WEEKS_TO_DISPLAY = 4;

type WeeklyAccumulator = AtlasWeeklyWorkHours & { weekStartDate: Date };

/**
 * Founder activity is intentionally independent of the retired Atlas mission model.
 * The dashboard consumes only conservatively classified activity blocks; it does not
 * read Atlas graph scores, forecasts, or operational evidence.
 */
export async function getFounderOsMomentum(input: { now?: Date; activityEvents?: AtlasActivityEvent[] } = {}): Promise<AtlasMomentumSummary> {
  const now = input.now ?? new Date();
  const activityEvents = input.activityEvents ?? await loadAtlasActivityEvents({ now });
  const weeklyWorkHistory = await persistFounderOsWeeklyHours(activityEvents, now);
  return { ...summarizeMomentum(activityEvents, now), weeklyWorkHistory };
}

/**
 * Builds four Sunday-to-Saturday weekly counters from direct-evidence work only.
 * A block spanning a Sunday is split between its two calendar weeks rather than
 * silently assigning all of its time to its start date.
 */
export function buildSundayWeeklyWorkHours(activityEvents: AtlasActivityEvent[], now: Date): AtlasWeeklyWorkHours[] {
  const weeks = buildWeekAccumulators(now);
  const byWeekStart = new Map(weeks.map((week) => [week.weekStart, week]));

  for (const event of activityEvents) {
    const startedAt = new Date(event.startedAt);
    const endedAt = new Date(event.endedAt);
    if (!Number.isFinite(startedAt.getTime()) || !Number.isFinite(endedAt.getTime()) || endedAt <= startedAt) continue;

    const eventDurationHours = durationHours(event, startedAt, endedAt);
    const wallClockMs = endedAt.getTime() - startedAt.getTime();
    for (const segment of splitAcrossSundayWeeks(startedAt, endedAt)) {
      const week = byWeekStart.get(segment.weekStart);
      if (!week) continue;
      week.sourceBlockCount += 1;
      if (!isClassifiedWork(event)) continue;

      const segmentHours = eventDurationHours * ((segment.endedAt.getTime() - segment.startedAt.getTime()) / wallClockMs);
      week.workedHours += segmentHours;
      week.workBlockCount += 1;
      if (event.leverageTier === "HIGH" && event.validatedProgress) week.highLeverageHours += segmentHours;
    }
  }

  return weeks.map(({ weekStartDate, ...week }) => {
    void weekStartDate;
    return {
      ...week,
      workedHours: roundOne(week.workedHours),
      highLeverageHours: roundOne(week.highLeverageHours)
    };
  });
}

async function persistFounderOsWeeklyHours(activityEvents: AtlasActivityEvent[], now: Date): Promise<AtlasWeeklyWorkHours[]> {
  const freshWeeks = buildWeekAccumulators(now);
  const freshByWeekStart = new Map(buildSundayWeeklyWorkHours(activityEvents, now).map((week) => [week.weekStart, week]));

  try {
    const observedWeeks = freshWeeks
      .map(({ weekStartDate }) => freshByWeekStart.get(calendarDateKey(weekStartDate)))
      .filter((week): week is AtlasWeeklyWorkHours => Boolean(week && week.sourceBlockCount > 0));

    await Promise.all(observedWeeks.map((week) => prisma.founderActivityWeek.upsert({
      where: { weekStart_timezone: { weekStart: weekStartAsDate(week.weekStart), timezone: FOUNDER_OS_TIMEZONE } },
      create: {
        weekStart: weekStartAsDate(week.weekStart),
        timezone: FOUNDER_OS_TIMEZONE,
        workedMinutes: Math.round(week.workedHours * 60),
        highLeverageMinutes: Math.round(week.highLeverageHours * 60),
        workBlockCount: week.workBlockCount,
        sourceBlockCount: week.sourceBlockCount,
        observedAt: now
      },
      update: {
        workedMinutes: Math.round(week.workedHours * 60),
        highLeverageMinutes: Math.round(week.highLeverageHours * 60),
        workBlockCount: week.workBlockCount,
        sourceBlockCount: week.sourceBlockCount,
        observedAt: now
      }
    })));

    const oldestWeekStart = freshWeeks[0].weekStartDate;
    const newestWeekStart = freshWeeks.at(-1)?.weekStartDate ?? oldestWeekStart;
    const stored = await prisma.founderActivityWeek.findMany({
      where: { timezone: FOUNDER_OS_TIMEZONE, weekStart: { gte: oldestWeekStart, lte: newestWeekStart } },
      orderBy: { weekStart: "asc" }
    });
    const storedByWeekStart = new Map(stored.map((week) => [calendarDateKey(week.weekStart), week]));

    return buildSundayWeeklyWorkHours(activityEvents, now).map((week) => {
      const storedWeek = storedByWeekStart.get(week.weekStart);
      if (!storedWeek) return week;
      return {
        ...week,
        workedHours: roundOne(storedWeek.workedMinutes / 60),
        highLeverageHours: roundOne(storedWeek.highLeverageMinutes / 60),
        workBlockCount: storedWeek.workBlockCount,
        sourceBlockCount: storedWeek.sourceBlockCount,
        recorded: true
      };
    });
  } catch {
    // Dashboard availability must not depend on optional analytics persistence. The
    // unsaved live calculation remains useful and is marked recorded:false for UI.
    return buildSundayWeeklyWorkHours(activityEvents, now);
  }
}

function buildWeekAccumulators(now: Date): WeeklyAccumulator[] {
  const currentWeekStart = sundayWeekStart(now);
  return Array.from({ length: WEEKS_TO_DISPLAY }, (_, index) => {
    const weekStartDate = addCalendarDays(currentWeekStart, (index - (WEEKS_TO_DISPLAY - 1)) * 7);
    return {
      weekStartDate,
      weekStart: calendarDateKey(weekStartDate),
      weekEnd: calendarDateKey(addCalendarDays(weekStartDate, 6)),
      label: formatWeekLabel(weekStartDate),
      workedHours: 0,
      highLeverageHours: 0,
      workBlockCount: 0,
      sourceBlockCount: 0,
      isCurrentWeek: index === WEEKS_TO_DISPLAY - 1,
      recorded: false
    };
  });
}

function splitAcrossSundayWeeks(startedAt: Date, endedAt: Date) {
  const segments: Array<{ weekStart: string; startedAt: Date; endedAt: Date }> = [];
  let cursor = startedAt;
  while (cursor < endedAt) {
    const weekStartDate = sundayWeekStart(cursor);
    const nextWeekStart = torontoMidnight(addCalendarDays(weekStartDate, 7));
    const segmentEnd = nextWeekStart < endedAt ? nextWeekStart : endedAt;
    segments.push({ weekStart: calendarDateKey(weekStartDate), startedAt: cursor, endedAt: segmentEnd });
    cursor = segmentEnd;
  }
  return segments;
}

function sundayWeekStart(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: FOUNDER_OS_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date)
    .reduce<Record<string, string>>((values, part) => ({ ...values, [part.type]: part.value }), {});
  const localCalendarDate = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  return addCalendarDays(localCalendarDate, -localCalendarDate.getUTCDay());
}

/** Converts a Toronto calendar date (represented at UTC midnight) to its actual local midnight instant. */
function torontoMidnight(calendarDate: Date) {
  const candidate = new Date(Date.UTC(
    calendarDate.getUTCFullYear(),
    calendarDate.getUTCMonth(),
    calendarDate.getUTCDate()
  ));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: FOUNDER_OS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  })
    .formatToParts(candidate)
    .reduce<Record<string, string>>((values, part) => ({ ...values, [part.type]: part.value }), {});
  const localAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return new Date(candidate.getTime() - (localAsUtc - candidate.getTime()));
}

function addCalendarDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function calendarDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function weekStartAsDate(weekStart: string) {
  return new Date(`${weekStart}T00:00:00.000Z`);
}

function formatWeekLabel(weekStart: Date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(weekStart);
}

function durationHours(event: AtlasActivityEvent, startedAt: Date, endedAt: Date) {
  if (Number.isFinite(event.durationHours) && Number(event.durationHours) >= 0) return Number(event.durationHours);
  return (endedAt.getTime() - startedAt.getTime()) / 3_600_000;
}

function isClassifiedWork(event: AtlasActivityEvent) {
  const measured = event.activityClassification ? event.activityClassification === "WORK" : event.category !== "Unknown";
  return measured && event.category !== "Distraction" && event.leverageTier !== "LOW";
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}
