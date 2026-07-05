import { describe, expect, it } from "vitest";
import { getAtlasSeedGraph } from "./seed-graph";
import { buildAtlasMissionControl, isStaleEvidence, scoreAtlasNodes } from "./scoring";
import type { AtlasActivityEvent, AtlasEvidence } from "./types";

const now = new Date("2026-07-01T12:00:00.000Z");

describe("Atlas scoring", () => {
  it("does not increase completion from time-only activity without validated progress", () => {
    const nodes = getAtlasSeedGraph();
    const before = scoreAtlasNodes(nodes, [], []);
    const unvalidatedActivity: AtlasActivityEvent = {
      id: "activity:firmware-time",
      nodeId: "engineering.firmware",
      category: "Firmware",
      leverageTier: "HIGH",
      confidencePct: 90,
      startedAt: "2026-07-01T08:00:00.000Z",
      endedAt: "2026-07-01T12:00:00.000Z",
      summary: "Four hours in firmware editor without linked validated artifact.",
      sourceType: "FILE",
      sourceRef: "activity-log",
      validatedProgress: false,
      progressContributionPct: 20
    };

    const after = scoreAtlasNodes(nodes, [], [unvalidatedActivity]);
    expect(after.find((node) => node.id === "engineering.firmware")?.completionPct).toBe(before.find((node) => node.id === "engineering.firmware")?.completionPct);
  });

  it("lets validated evidence drive launch probability and highest-leverage task", () => {
    const evidence: AtlasEvidence[] = [
      {
        id: "dashboard:coverage",
        nodeId: "inventory.phase1-coverage",
        sourceType: "INVENTORY",
        sourceRef: "test",
        summary: "10/25 units ready.",
        confidencePct: 90,
        observedAt: now.toISOString(),
        completionPct: 40,
        riskScore: 70,
        impactScore: 100,
        estimatedHours: 12,
        validatedProgress: true
      },
      {
        id: "purchasing:blocker",
        nodeId: "manufacturing.supplier-qualification",
        sourceType: "PURCHASING",
        sourceRef: "test",
        summary: "Supplier qualification is the largest open launch blocker.",
        confidencePct: 82,
        observedAt: now.toISOString(),
        completionPct: 25,
        riskScore: 88,
        impactScore: 96,
        estimatedHours: 10,
        validatedProgress: true
      }
    ];

    const result = buildAtlasMissionControl({ nodes: getAtlasSeedGraph(), evidence, now });
    expect(result.launchProbability.low).toBeLessThan(result.launchProbability.high);
    expect(result.highestLeverageTask?.nodeId).toBe("manufacturing.supplier-qualification");
    expect(result.realityStatement).toContain("Supplier Qualification");
    expect(result.evidenceCoverage.sourceCount).toBe(2);
  });

  it("projects a launch date from validated high-leverage Founder OS activity without increasing completion by time alone", () => {
    const activityEvents: AtlasActivityEvent[] = [
      {
        id: "founder-os:firmware-block",
        nodeId: "engineering.firmware",
        category: "Firmware",
        leverageTier: "HIGH",
        confidencePct: 82,
        startedAt: "2026-07-01T08:00:00.000Z",
        endedAt: "2026-07-01T12:00:00.000Z",
        summary: "4h firmware work from Founder OS activity coverage.",
        sourceType: "FILE",
        sourceRef: "founder_os/activity_blocks.jsonl",
        validatedProgress: true
      }
    ];

    const nodes = getAtlasSeedGraph();
    const before = scoreAtlasNodes(nodes, [], []);
    const after = scoreAtlasNodes(nodes, [], activityEvents);
    const result = buildAtlasMissionControl({ nodes, evidence: [], activityEvents, now });

    expect(after.find((node) => node.id === "engineering.firmware")?.completionPct).toBe(before.find((node) => node.id === "engineering.firmware")?.completionPct);
    expect(result.weeklyVelocity.currentHours).toBe(4);
    expect(result.projectedLaunchDate.p50).not.toBeNull();
    expect(result.counterfactuals[0]).toContain("current validated execution rate");
  });

  it("summarizes today's worked time by sector without counting older activity as today's work", () => {
    const activityEvents: AtlasActivityEvent[] = [
      {
        id: "founder-os:engineering-today",
        nodeId: "engineering.electronics",
        category: "Engineering",
        leverageTier: "HIGH",
        confidencePct: 80,
        startedAt: "2026-07-01T13:00:00.000Z",
        endedAt: "2026-07-01T15:00:00.000Z",
        summary: "2h inventory engineering work.",
        sourceType: "FILE",
        sourceRef: "founder_os/activity_blocks.jsonl",
        validatedProgress: true
      },
      {
        id: "founder-os:planning-today",
        category: "Planning",
        leverageTier: "MEDIUM",
        confidencePct: 70,
        startedAt: "2026-07-01T15:00:00.000Z",
        endedAt: "2026-07-01T15:30:00.000Z",
        summary: "0.5h planning work.",
        sourceType: "FILE",
        sourceRef: "founder_os/activity_blocks.jsonl",
        validatedProgress: false
      },
      {
        id: "founder-os:firmware-yesterday",
        nodeId: "engineering.firmware",
        category: "Firmware",
        leverageTier: "HIGH",
        confidencePct: 90,
        startedAt: "2026-06-30T13:00:00.000Z",
        endedAt: "2026-06-30T14:00:00.000Z",
        summary: "1h firmware work from yesterday.",
        sourceType: "FILE",
        sourceRef: "founder_os/activity_blocks.jsonl",
        validatedProgress: true
      },
      {
        id: "founder-os:idle-overnight",
        category: "Unknown",
        leverageTier: "LOW",
        confidencePct: 82,
        startedAt: "2026-07-01T04:45:00.000Z",
        endedAt: "2026-07-01T12:15:00.000Z",
        durationHours: 5.65,
        summary: "Overnight Hermes idle block.",
        sourceType: "FILE",
        sourceRef: "founder_os/activity_blocks.jsonl",
        validatedProgress: false
      }
    ];

    const result = buildAtlasMissionControl({ nodes: getAtlasSeedGraph(), evidence: [], activityEvents, now });

    expect(result.momentum.dailyTotalHours).toBe(2.5);
    expect(result.momentum.dailySectorWork).toEqual([
      { sector: "Engineering", hours: 2, highLeverageHours: 2, eventCount: 1, confidencePct: 80 },
      { sector: "Planning", hours: 0.5, highLeverageHours: 0, eventCount: 1, confidencePct: 70 }
    ]);
    expect(result.momentum.weeklyDeepWorkHours).toBe(3);
  });

  it("counts stale evidence and discounts confidence instead of treating old signals as current truth", () => {
    const freshEvidence: AtlasEvidence = {
      id: "tracking:fresh",
      nodeId: "operations.shipping",
      sourceType: "TRACKING",
      sourceRef: "getTrackingDashboard.summary",
      summary: "Fresh tracking evidence.",
      confidencePct: 90,
      observedAt: "2026-06-30T12:00:00.000Z",
      completionPct: 70,
      riskScore: 40,
      impactScore: 70,
      validatedProgress: true
    };
    const staleEvidence: AtlasEvidence = {
      ...freshEvidence,
      id: "tracking:stale",
      observedAt: "2026-06-20T12:00:00.000Z"
    };

    expect(isStaleEvidence(freshEvidence, now)).toBe(false);
    expect(isStaleEvidence(staleEvidence, now)).toBe(true);

    const fresh = buildAtlasMissionControl({ nodes: getAtlasSeedGraph(), evidence: [freshEvidence], now });
    const stale = buildAtlasMissionControl({ nodes: getAtlasSeedGraph(), evidence: [staleEvidence], now });

    expect(stale.evidenceCoverage.staleEvidenceCount).toBe(1);
    expect(fresh.evidenceCoverage.staleEvidenceCount).toBe(0);
    expect(stale.evidenceCoverage.confidencePct).toBeLessThan(fresh.evidenceCoverage.confidencePct);
    expect(stale.graph.nodes.find((node) => node.id === "operations.shipping")?.effectiveRiskScore)
      .toBeGreaterThan(fresh.graph.nodes.find((node) => node.id === "operations.shipping")?.effectiveRiskScore ?? 0);
  });
});
