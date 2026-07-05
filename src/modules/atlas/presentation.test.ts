import { describe, expect, it } from "vitest";
import { buildAtlasDailyBrief, buildAtlasMissionControlView, sanitizeAtlasEvidence } from "./presentation";
import { buildAtlasMissionControl } from "./scoring";
import { getAtlasSeedGraph } from "./seed-graph";
import type { AtlasEvidence } from "./types";

const now = new Date("2026-07-01T12:00:00.000Z");

const privateEvidence: AtlasEvidence = {
  id: "accounting:private-doc",
  nodeId: "finance.cash-runway",
  sourceType: "ACCOUNTING",
  sourceRef: "C:/Users/musas/Desktop/lambenti-inventory/var/accounting-documents/private.pdf",
  summary: "Accounting source document is reviewed without exposing private storage path.",
  confidencePct: 80,
  observedAt: now.toISOString(),
  href: "/accounting",
  completionPct: 60,
  riskScore: 40,
  impactScore: 70,
  validatedProgress: true
};

describe("Atlas presentation/privacy helpers", () => {
  it("sanitizes evidence for display without leaking raw source references", () => {
    const display = sanitizeAtlasEvidence(privateEvidence);

    expect(display).toEqual({
      id: "accounting:private-doc",
      nodeId: "finance.cash-runway",
      sourceType: "ACCOUNTING",
      sourceLabel: "Accounting evidence",
      privacyLevel: "internal",
      summary: "Accounting source document is reviewed without exposing private storage path.",
      confidencePct: 80,
      observedAt: now.toISOString(),
      href: "/accounting"
    });
    expect(JSON.stringify(display)).not.toContain("sourceRef");
    expect(JSON.stringify(display)).not.toContain("var/accounting-documents");
  });

  it("builds a public Atlas view with sanitized graph evidence and daily brief markers", () => {
    const atlas = buildAtlasMissionControl({ nodes: getAtlasSeedGraph(), evidence: [privateEvidence], now });
    const view = buildAtlasMissionControlView(atlas);
    const json = JSON.stringify(view);

    expect(view.dailyBrief.nextAction.title.length).toBeGreaterThan(0);
    expect(view.dailyBrief.confidenceMarker).toContain("evidence confidence");
    expect(view.dailyBrief.privacyMarker).toContain("Raw source refs are withheld");
    expect(view.decisionTimeline.map((entry) => entry.label)).toContain("Evidence Health");
    expect(view.decisionTimeline.map((entry) => entry.label)).toContain("Forecast Trust");
    expect(json).not.toContain("sourceRef");
    expect(json).not.toContain("var/accounting-documents");
    expect(view.graph.nodes.flatMap((node) => node.evidence).every((evidence) => "sourceLabel" in evidence)).toBe(true);
  });

  it("surfaces sparse-velocity and stale-evidence caveats in the daily brief", () => {
    const staleEvidence: AtlasEvidence = {
      ...privateEvidence,
      observedAt: "2026-05-01T12:00:00.000Z"
    };
    const atlas = buildAtlasMissionControl({ nodes: getAtlasSeedGraph(), evidence: [staleEvidence], now });
    const brief = buildAtlasDailyBrief(atlas);

    expect(brief.velocityCaveat).toContain("Validated activity velocity is unavailable");
    expect(brief.confidenceMarker).toContain("stale evidence signal");
  });
});
