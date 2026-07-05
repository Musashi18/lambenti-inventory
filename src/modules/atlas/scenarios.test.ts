import { describe, expect, it } from "vitest";
import { buildAtlasMissionControl } from "./scoring";
import { getAtlasSeedGraph } from "./seed-graph";
import { simulateAtlasScenario } from "./scenarios";

const base = buildAtlasMissionControl({
  nodes: getAtlasSeedGraph(),
  evidence: [
    {
      id: "coverage",
      nodeId: "inventory.phase1-coverage",
      sourceType: "INVENTORY",
      sourceRef: "test",
      summary: "5/25 units ready.",
      confidencePct: 80,
      observedAt: "2026-07-01T12:00:00.000Z",
      completionPct: 20,
      riskScore: 75,
      impactScore: 100,
      validatedProgress: true
    }
  ],
  activityEvents: [
    {
      id: "validated-work",
      nodeId: "inventory.phase1-coverage",
      category: "Manufacturing",
      leverageTier: "HIGH",
      confidencePct: 80,
      startedAt: "2026-07-01T08:00:00.000Z",
      endedAt: "2026-07-01T12:00:00.000Z",
      summary: "Validated build work.",
      sourceType: "MANUAL",
      sourceRef: "test",
      validatedProgress: true
    }
  ],
  now: new Date("2026-07-01T12:00:00.000Z")
});

describe("Atlas predictive simulator", () => {
  it("models added focus hours as timeline improvement without treating time as direct completion", () => {
    const scenario = simulateAtlasScenario(base, { kind: "FOCUS_HOURS", focusedHoursPerDay: 6 });
    expect(scenario.timelineDeltaDays).toBeLessThanOrEqual(0);
    expect(scenario.launchProbability.p50).toBeGreaterThanOrEqual(base.launchProbability.p50);
    expect(scenario.assumptions.join(" ")).toContain("hours alone only change timeline confidence");
  });

  it("bounds focus-hour simulation inputs server-side", () => {
    expect(simulateAtlasScenario(base, { kind: "FOCUS_HOURS", focusedHoursPerDay: 999 }).title).toBe("12 Focused Hours / Day");
    expect(simulateAtlasScenario(base, { kind: "FOCUS_HOURS", focusedHoursPerDay: -4 }).title).toBe("1 Focused Hours / Day");
    expect(simulateAtlasScenario(base, { kind: "FOCUS_HOURS", focusedHoursPerDay: Number.NaN }).title).toBe("6 Focused Hours / Day");
    expect(simulateAtlasScenario(base, { kind: "FOCUS_HOURS", focusedHoursPerDay: 6.24 }).title).toBe("6 Focused Hours / Day");
    expect(simulateAtlasScenario(base, { kind: "FOCUS_HOURS", focusedHoursPerDay: 6.26 }).title).toBe("6.5 Focused Hours / Day");
  });

  it("shows outsourcing PCB assembly as lower manufacturing-delay risk with explicit assumptions", () => {
    const scenario = simulateAtlasScenario(base, { kind: "OUTSOURCE_PCB_ASSEMBLY" });
    expect(scenario.manufacturingDelayRisk.p50).toBeLessThan(base.manufacturingDelayRisk.p50);
    expect(scenario.estimatedCompanyValueCreation).toBe("high");
  });
});
