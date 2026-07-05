import type { AtlasEvidence, AtlasMissionControl, AtlasRankedSignal } from "./types";

export type AtlasEvidencePrivacyLevel = "operator" | "internal";

export type AtlasEvidenceDisplay = {
  id: string;
  nodeId: string;
  sourceType: AtlasEvidence["sourceType"];
  sourceLabel: string;
  privacyLevel: AtlasEvidencePrivacyLevel;
  summary: string;
  confidencePct: number;
  observedAt: string;
  href?: string;
};

export type AtlasRankedSignalDisplay = Omit<AtlasRankedSignal, "supportingEvidence"> & {
  supportingEvidence: AtlasEvidenceDisplay[];
};

export type AtlasDailyBrief = {
  nextAction: {
    title: string;
    summary: string;
    href?: string;
  };
  topRisk: {
    title: string;
    summary: string;
    href?: string;
  };
  velocityCaveat: string;
  confidenceMarker: string;
  privacyMarker: string;
};

export type AtlasDecisionTimelineEntry = {
  label: string;
  summary: string;
  confidencePct: number;
  href?: string;
};

export type AtlasMissionControlView = Omit<AtlasMissionControl, "currentBottleneck" | "largestRisk" | "highestLeverageTask" | "graph"> & {
  currentBottleneck: AtlasRankedSignalDisplay | null;
  largestRisk: AtlasRankedSignalDisplay | null;
  highestLeverageTask: (Omit<NonNullable<AtlasMissionControl["highestLeverageTask"]>, "supportingEvidence" | "alternatives"> & {
    supportingEvidence: AtlasEvidenceDisplay[];
    alternatives: AtlasRankedSignalDisplay[];
  }) | null;
  graph: Omit<AtlasMissionControl["graph"], "nodes"> & {
    nodes: Array<Omit<AtlasMissionControl["graph"]["nodes"][number], "evidence" | "blockers"> & {
      evidence: AtlasEvidenceDisplay[];
      blockers: AtlasEvidenceDisplay[];
    }>;
  };
  dailyBrief: AtlasDailyBrief;
  decisionTimeline: AtlasDecisionTimelineEntry[];
};

export function sanitizeAtlasEvidence(evidence: AtlasEvidence): AtlasEvidenceDisplay {
  return {
    id: evidence.id,
    nodeId: evidence.nodeId,
    sourceType: evidence.sourceType,
    sourceLabel: sourceLabel(evidence),
    privacyLevel: evidencePrivacyLevel(evidence),
    summary: evidence.summary,
    confidencePct: evidence.confidencePct,
    observedAt: evidence.observedAt,
    href: evidence.href
  };
}

export function sanitizeAtlasRankedSignal(signal: AtlasRankedSignal): AtlasRankedSignalDisplay {
  return {
    ...signal,
    supportingEvidence: signal.supportingEvidence.map(sanitizeAtlasEvidence)
  };
}

export function buildAtlasDailyBrief(atlas: AtlasMissionControl): AtlasDailyBrief {
  return {
    nextAction: atlas.highestLeverageTask
      ? {
          title: atlas.highestLeverageTask.title,
          summary: atlas.highestLeverageTask.summary,
          href: atlas.highestLeverageTask.href
        }
      : {
          title: "Collect stronger evidence",
          summary: "Atlas needs more validated operational evidence before ranking the next action."
        },
    topRisk: atlas.largestRisk
      ? {
          title: atlas.largestRisk.title,
          summary: atlas.largestRisk.summary,
          href: atlas.largestRisk.href
        }
      : {
          title: "No major risk ranked yet",
          summary: "Atlas has not found enough evidence to rank a dominant launch risk."
        },
    velocityCaveat: atlas.weeklyVelocity.currentHours == null
      ? "Validated activity velocity is unavailable; date forecasts stay unknown."
      : atlas.weeklyVelocity.currentHours < 2
        ? `Validated activity coverage is enabled but sparse (${atlas.weeklyVelocity.currentHours}h); Atlas will not project a credible activity date below ~2h.`
        : `Validated activity velocity is ${atlas.weeklyVelocity.currentHours}h/week against a ${atlas.weeklyVelocity.requiredHours ?? "unknown"}h/week target.`,
    confidenceMarker: atlas.evidenceCoverage.staleEvidenceCount > 0
      ? `${atlas.evidenceCoverage.staleEvidenceCount} stale evidence signal(s); confidence is discounted.`
      : `${atlas.evidenceCoverage.confidencePct}% evidence confidence across ${atlas.evidenceCoverage.sourceCount} source type(s).`,
    privacyMarker: "Raw source refs are withheld from Atlas display/API payloads; open linked workflows for provenance."
  };
}

export function buildAtlasMissionControlView(atlas: AtlasMissionControl): AtlasMissionControlView {
  return {
    ...atlas,
    currentBottleneck: atlas.currentBottleneck ? sanitizeAtlasRankedSignal(atlas.currentBottleneck) : null,
    largestRisk: atlas.largestRisk ? sanitizeAtlasRankedSignal(atlas.largestRisk) : null,
    highestLeverageTask: atlas.highestLeverageTask
      ? {
          ...atlas.highestLeverageTask,
          supportingEvidence: atlas.highestLeverageTask.supportingEvidence.map(sanitizeAtlasEvidence),
          alternatives: atlas.highestLeverageTask.alternatives.map(sanitizeAtlasRankedSignal)
        }
      : null,
    graph: {
      ...atlas.graph,
      nodes: atlas.graph.nodes.map((node) => ({
        ...node,
        evidence: node.evidence.map(sanitizeAtlasEvidence),
        blockers: node.blockers.map(sanitizeAtlasEvidence)
      }))
    },
    dailyBrief: buildAtlasDailyBrief(atlas),
    decisionTimeline: buildAtlasDecisionTimeline(atlas)
  };
}

export function buildAtlasDecisionTimeline(atlas: AtlasMissionControl): AtlasDecisionTimelineEntry[] {
  const brief = buildAtlasDailyBrief(atlas);
  return [
    {
      label: "Generated",
      summary: `Atlas regenerated from live operational evidence at ${atlas.generatedAt}.`,
      confidencePct: atlas.evidenceCoverage.confidencePct
    },
    atlas.currentBottleneck
      ? {
          label: "Current Bottleneck",
          summary: `${atlas.currentBottleneck.title}: ${atlas.currentBottleneck.summary}`,
          confidencePct: atlas.currentBottleneck.confidencePct,
          href: atlas.currentBottleneck.href
        }
      : {
          label: "Current Bottleneck",
          summary: "No dominant bottleneck is ranked yet.",
          confidencePct: atlas.evidenceCoverage.confidencePct
        },
    atlas.largestRisk
      ? {
          label: "Largest Risk",
          summary: `${atlas.largestRisk.title}: ${atlas.largestRisk.summary}`,
          confidencePct: atlas.largestRisk.confidencePct,
          href: atlas.largestRisk.href
        }
      : {
          label: "Largest Risk",
          summary: "No dominant risk is ranked yet.",
          confidencePct: atlas.evidenceCoverage.confidencePct
        },
    {
      label: "Forecast Trust",
      summary: brief.velocityCaveat,
      confidencePct: atlas.weeklyVelocity.confidencePct
    },
    {
      label: "Evidence Health",
      summary: atlas.evidenceCoverage.staleEvidenceCount > 0
        ? `${atlas.evidenceCoverage.staleEvidenceCount} stale signal(s) are discounting Atlas confidence.`
        : `No stale signals detected across ${atlas.evidenceCoverage.sourceCount} source type(s).`,
      confidencePct: atlas.evidenceCoverage.confidencePct
    }
  ];
}

function sourceLabel(evidence: AtlasEvidence) {
  if (evidence.sourceType === "INVENTORY") return "Inventory evidence";
  if (evidence.sourceType === "BOM") return "BOM evidence";
  if (evidence.sourceType === "PURCHASING") return "Purchasing evidence";
  if (evidence.sourceType === "TRACKING") return "Shipment tracking evidence";
  if (evidence.sourceType === "ACCOUNTING") return "Accounting evidence";
  if (evidence.sourceType === "AUTOMATION") return "Automation evidence";
  if (evidence.sourceType === "EMAIL") return "Email evidence";
  if (evidence.sourceType === "FILE") return "Founder OS activity evidence";
  return "Atlas evidence";
}

function evidencePrivacyLevel(evidence: AtlasEvidence): AtlasEvidencePrivacyLevel {
  if (["ACCOUNTING", "EMAIL", "FILE", "HERMES_MEMORY", "EXTERNAL_ANALYTICS"].includes(evidence.sourceType)) return "internal";
  return "operator";
}
