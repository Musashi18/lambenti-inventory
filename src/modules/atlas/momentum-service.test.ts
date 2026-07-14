import { describe, expect, it } from "vitest";
import { buildSundayWeeklyWorkHours } from "./momentum-service";
import type { AtlasActivityEvent } from "./types";

function workEvent(input: Partial<AtlasActivityEvent> & Pick<AtlasActivityEvent, "id" | "startedAt" | "endedAt">): AtlasActivityEvent {
  return {
    category: "Engineering",
    leverageTier: "HIGH",
    confidencePct: 90,
    durationHours: 1,
    summary: "Test work evidence",
    sourceType: "FILE",
    sourceRef: "test",
    validatedProgress: true,
    activityClassification: "WORK",
    ...input
  };
}

describe("Founder OS Sunday-week work history", () => {
  it("returns exactly four Sunday-start weeks and resets the current counter on Sunday", () => {
    const now = new Date("2026-07-13T15:00:00.000Z");
    const weeklyHours = buildSundayWeeklyWorkHours([
      workEvent({ id: "week-one", startedAt: "2026-06-22T14:00:00.000Z", endedAt: "2026-06-22T17:00:00.000Z", durationHours: 3 }),
      workEvent({ id: "week-two", startedAt: "2026-06-29T14:00:00.000Z", endedAt: "2026-06-29T16:00:00.000Z", durationHours: 2 }),
      // Saturday 23:00 to Sunday 01:00 Toronto time must be split between weeks.
      workEvent({ id: "sunday-boundary", startedAt: "2026-07-12T03:00:00.000Z", endedAt: "2026-07-12T05:00:00.000Z", durationHours: 2 }),
      workEvent({ id: "new-week", startedAt: "2026-07-12T14:00:00.000Z", endedAt: "2026-07-12T16:00:00.000Z", durationHours: 2 }),
      workEvent({ id: "idle", startedAt: "2026-07-12T16:00:00.000Z", endedAt: "2026-07-12T17:00:00.000Z", activityClassification: "IDLE", durationHours: 1 })
    ], now);

    expect(weeklyHours).toHaveLength(4);
    expect(weeklyHours.map((week) => week.weekStart)).toEqual(["2026-06-21", "2026-06-28", "2026-07-05", "2026-07-12"]);
    expect(weeklyHours.map((week) => week.workedHours)).toEqual([3, 2, 1, 3]);
    expect(weeklyHours.map((week) => week.isCurrentWeek)).toEqual([false, false, false, true]);
    expect(weeklyHours.at(-1)).toMatchObject({ weekEnd: "2026-07-18", label: "Jul 12", workBlockCount: 2, sourceBlockCount: 3, recorded: false });
  });

  it("always emits visible zero-hour weeks and excludes unclassified/distraction time", () => {
    const weeks = buildSundayWeeklyWorkHours([
      workEvent({ id: "distraction", startedAt: "2026-07-06T14:00:00.000Z", endedAt: "2026-07-06T16:00:00.000Z", category: "Distraction", leverageTier: "LOW", activityClassification: "DISTRACTION", durationHours: 2 })
    ], new Date("2026-07-13T15:00:00.000Z"));

    expect(weeks).toHaveLength(4);
    expect(weeks.map((week) => week.workedHours)).toEqual([0, 0, 0, 0]);
    expect(weeks[2]).toMatchObject({ sourceBlockCount: 1, workBlockCount: 0 });
  });
});
