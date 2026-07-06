import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAtlasActivityEvents, parseFounderOsActivityBlocks } from "./activity-events";

describe("Atlas Founder OS activity events", () => {
  it("maps the latest weekly Founder OS blocks into validated Atlas velocity events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atlas-activity-"));
    const blocksPath = join(dir, "activity_blocks.jsonl");
    await writeFile(blocksPath, [
      JSON.stringify({
        period: "daily",
        label: "2026-07-01",
        start: "2026-07-01T10:00:00-04:00",
        end: "2026-07-01T11:00:00-04:00",
        category: "Engineering",
        leverage: "High",
        confidence: 0.76,
        depth: "deep",
        hours: 1,
        top_signals: ["Inventory/software engineering evidence"],
        artifact_types: ["software_source"],
        file_examples: ["inventory_repo:src/modules/atlas/service.ts"]
      }),
      JSON.stringify({
        period: "weekly",
        label: "week 2026-06-29 to 2026-07-05",
        start: "2026-07-02T08:00:00-04:00",
        end: "2026-07-02T10:30:00-04:00",
        category: "Firmware",
        leverage: "High",
        confidence: 0.82,
        depth: "deep",
        hours: 2.5,
        top_signals: ["Firmware evidence"],
        artifact_types: ["software_source"],
        file_examples: ["product_workspace:firmware/arduino/Lambenti.ino"]
      }),
      JSON.stringify({
        period: "weekly",
        label: "week 2026-06-29 to 2026-07-05",
        start: "2026-07-02T10:30:00-04:00",
        end: "2026-07-02T11:00:00-04:00",
        category: "Unknown",
        leverage: "Low",
        confidence: 0.9,
        depth: "idle",
        hours: 0.5,
        top_signals: ["idle_seconds=990"]
      })
    ].join("\n"), "utf8");

    const events = await loadAtlasActivityEvents({ blocksPath, now: new Date("2026-07-02T16:00:00.000Z") });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ category: "Firmware", leverageTier: "HIGH", confidencePct: 82, durationHours: 2.5, validatedProgress: true, nodeId: "engineering.firmware" });
    expect(events[1]).toMatchObject({ category: "Unknown", leverageTier: "LOW", durationHours: 0.5, validatedProgress: false });
  });

  it("deduplicates repeated exported blocks and keeps completion contributions empty", () => {
    const line = JSON.stringify({
      period: "weekly",
      label: "week 2026-06-29 to 2026-07-05",
      start: "2026-07-02T08:00:00-04:00",
      end: "2026-07-02T09:00:00-04:00",
      category: "Manufacturing",
      leverage: "High",
      confidence: 0.78,
      depth: "deep",
      hours: 1,
      top_signals: ["Manufacturing/production evidence"],
      file_examples: ["inventory_repo:scripts/ui-contract-smoke.mjs"]
    });

    const events = parseFounderOsActivityBlocks(`${line}\n${line}\n`, { now: new Date("2026-07-02T16:00:00.000Z") });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ category: "Manufacturing", leverageTier: "HIGH", validatedProgress: true, nodeId: "manufacturing.qa" });
    expect(events[0].progressContributionPct).toBeUndefined();
  });

  it("keeps today's worked time current when the weekly export is older than the latest daily export", () => {
    const weeklyStale = JSON.stringify({
      period: "weekly",
      label: "week 2026-07-06 to 2026-07-12",
      start: "2026-07-06T08:00:00-04:00",
      end: "2026-07-06T08:30:00-04:00",
      category: "Planning",
      leverage: "Medium",
      confidence: 0.58,
      depth: "shallow",
      hours: 0.5,
      top_signals: ["Planning/priority evidence"],
      artifact_types: ["file"]
    });
    const dailyCurrent = JSON.stringify({
      period: "daily",
      label: "2026-07-06",
      start: "2026-07-06T15:00:00-04:00",
      end: "2026-07-06T15:45:00-04:00",
      category: "Engineering",
      leverage: "High",
      confidence: 0.76,
      depth: "deep",
      hours: 0.75,
      top_signals: ["Inventory/software engineering evidence"],
      artifact_types: ["software_source"]
    });

    const events = parseFounderOsActivityBlocks(`${weeklyStale}\n${dailyCurrent}\n`, { now: new Date("2026-07-06T19:50:00.000Z") });

    expect(events.map((event) => event.category)).toEqual(["Planning", "Engineering"]);
    expect(events.at(-1)).toMatchObject({ category: "Engineering", durationHours: 0.75, validatedProgress: true });
  });
});
