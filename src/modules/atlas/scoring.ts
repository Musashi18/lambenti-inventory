import type {
  AtlasActivityEvent,
  AtlasArea,
  AtlasDailySectorWork,
  AtlasEvidence,
  AtlasEvidenceCoverage,
  AtlasMissionControl,
  AtlasGoalMilestone,
  AtlasGoalPosition,
  AtlasPhaseOneReadinessInput,
  AtlasMomentumSummary,
  AtlasNode,
  AtlasNodeScore,
  AtlasOpportunity,
  AtlasProbabilityInterval,
  AtlasProjectedDate,
  AtlasRadarSector,
  AtlasRankedSignal
} from "./types";

const CRITICAL_SOURCE_LABELS = ["inventory", "tracking", "accounting", "automation"];

export function buildAtlasMissionControl(input: {
  nodes: AtlasNode[];
  evidence: AtlasEvidence[];
  activityEvents?: AtlasActivityEvent[];
  phaseOneReadiness?: AtlasPhaseOneReadinessInput;
  now?: Date;
}): AtlasMissionControl {
  const now = input.now ?? new Date();
  const nodeScores = scoreAtlasNodes(input.nodes, input.evidence, input.activityEvents ?? [], now);
  const dependencies = input.nodes.flatMap((node) => node.dependencies.map((dependency) => ({ from: dependency, to: node.id })));
  const phaseOneNodes = nodeScores.filter((node) => node.horizon === "PHASE_1");
  const missionCompletionPct = weightedAverage(phaseOneNodes, (node) => node.completionPct, (node) => node.weight);
  const companyCompletionPct = weightedAverage(nodeScores, (node) => node.completionPct, (node) => node.weight);
  const phaseOneCompletion = missionCompletionPct;
  const confidence = evidenceConfidence(input.evidence, nodeScores, now);
  const averageRisk = weightedAverage(nodeScores, (node) => node.effectiveRiskScore, (node) => node.weight);
  const riskPenalty = Math.round(averageRisk * 0.22);
  const launchP50 = clamp(Math.round((phaseOneCompletion * 0.78) + (confidence * 0.12) - riskPenalty), 1, 95);
  const intervalWidth = confidence >= 75 ? 8 : confidence >= 55 ? 14 : 22;
  const currentBottleneck = rankBottlenecks(nodeScores)[0] ?? null;
  const largestRisk = rankRisks(nodeScores)[0] ?? null;
  const highestLeverageTask = rankOpportunities(nodeScores)[0] ?? null;
  const remainingHours = estimateRemainingHours(phaseOneNodes);
  const weeklyVelocity = estimateWeeklyVelocity(input.activityEvents ?? [], remainingHours, now);
  const projectedLaunchDate = projectLaunchDate({ now, remainingHours, weeklyHours: weeklyVelocity.currentHours, confidencePct: weeklyVelocity.confidencePct });
  const coverage = summarizeEvidenceCoverage(input.nodes, input.evidence, confidence, now);
  const goalPosition = input.phaseOneReadiness ? buildGoalPosition(input.phaseOneReadiness, nodeScores) : null;

  return {
    missionCompletionPct,
    companyCompletionPct,
    launchProbability: interval(launchP50, intervalWidth, confidence),
    firstBatchSuccessProbability: interval(adjustProbabilityForNode(launchP50, findNode(nodeScores, "phase1.first-batch"), -4), intervalWidth + 2, confidence),
    customerExperienceProbability: interval(adjustProbabilityForNode(launchP50, findNode(nodeScores, "phase1.customer-experience"), -6), intervalWidth + 4, Math.max(20, confidence - 8)),
    manufacturingDelayRisk: riskInterval(findNode(nodeScores, "phase1.first-batch")?.effectiveRiskScore ?? averageRisk, confidence),
    cashShortageRisk: riskInterval(findNode(nodeScores, "finance.cash-runway")?.effectiveRiskScore ?? 55, Math.max(20, confidence - 12)),
    burnoutRisk: burnoutRisk(input.activityEvents ?? [], confidence),
    longTermSurvivalProbability: interval(clamp(Math.round((launchP50 * 0.52) + (companyCompletionPct * 0.22) - (averageRisk * 0.16)), 1, 85), intervalWidth + 10, Math.max(15, confidence - 20)),
    projectedLaunchDate,
    remainingHours,
    weeklyVelocity,
    currentBottleneck,
    largestRisk,
    highestLeverageTask,
    strategicRadar: summarizeRadar(nodeScores),
    momentum: summarizeMomentum(input.activityEvents ?? [], now),
    graph: { nodes: nodeScores, dependencies },
    evidenceCoverage: coverage,
    goalPosition,
    realityStatement: buildRealityStatement({ coverage, highestLeverageTask, largestRisk, activityEvents: input.activityEvents ?? [] }),
    counterfactuals: buildCounterfactuals({ remainingHours, weeklyVelocity, highestLeverageTask, launchProbability: interval(launchP50, intervalWidth, confidence) }),
    generatedAt: now.toISOString()
  };
}

export function scoreAtlasNodes(nodes: AtlasNode[], evidence: AtlasEvidence[], activityEvents: AtlasActivityEvent[] = [], now: Date = new Date()): AtlasNodeScore[] {
  const evidenceByNode = groupBy(evidence, (item) => item.nodeId);
  const validatedActivityByNode = groupBy(activityEvents.filter((event) => event.validatedProgress && event.nodeId), (event) => event.nodeId!);

  return nodes.map((node) => {
    const nodeEvidence = evidenceByNode.get(node.id) ?? [];
    const activityProgress = Math.max(0, ...((validatedActivityByNode.get(node.id) ?? []).map((event) => event.progressContributionPct ?? 0)));
    const currentCompletionEvidence = nodeEvidence.filter((item) =>
      item.validatedProgress !== false &&
      Number.isFinite(item.completionPct) &&
      !isStaleEvidence(item, now)
    );
    const staleCompletionEvidence = nodeEvidence.filter((item) =>
      item.validatedProgress !== false &&
      Number.isFinite(item.completionPct) &&
      isStaleEvidence(item, now)
    );
    const evidenceCompletion = currentCompletionEvidence.length > 0
      ? weightedAverage(currentCompletionEvidence, (item) => item.completionPct ?? 0, (item) => item.confidencePct)
      : null;
    // Time can only augment a separately validated progress contribution. It never turns a planning baseline into proof.
    const completionPct = evidenceCompletion == null
      ? 0
      : clamp(Math.round(Math.max(evidenceCompletion, evidenceCompletion + activityProgress)), 0, 100);
    const staleCount = nodeEvidence.filter((item) => isStaleEvidence(item, now)).length;
    const stalePenalty = Math.min(35, staleCount * 8);
    const evidenceConfidence = nodeEvidence.length > 0 ? Math.max(15, average(nodeEvidence.map((item) => item.confidencePct)) - stalePenalty) : 30;
    const activityConfidence = average((validatedActivityByNode.get(node.id) ?? []).map((event) => event.confidencePct));
    const measurementStatus = evidenceCompletion != null ? "MEASURED" : staleCompletionEvidence.length > 0 ? "STALE" : "UNMEASURED";
    const confidencePct = measurementStatus === "MEASURED"
      ? clamp(Math.round(Math.max(evidenceConfidence, activityConfidence || 0)), 0, 100)
      : measurementStatus === "STALE"
        ? clamp(Math.round(Math.min(35, evidenceConfidence)), 0, 100)
        : 0;
    const riskEvidence = Math.max(0, ...nodeEvidence.map((item) => item.riskScore ?? 0));
    const completionRiskRelief = Math.round(completionPct * 0.35);
    const effectiveRiskScore = clamp(Math.round(Math.max(node.riskScore || evidenceConfidence, riskEvidence) + stalePenalty - completionRiskRelief), 0, 100);
    const blockers = nodeEvidence
      .filter((item) => (item.riskScore ?? 0) >= 55 || (item.impactScore ?? 0) >= 70)
      .sort((left, right) => (right.riskScore ?? 0) - (left.riskScore ?? 0));

    return {
      ...node,
      completionPct,
      evidenceCompletionPct: evidenceCompletion == null ? null : clamp(Math.round(evidenceCompletion), 0, 100),
      planningBaselineCompletionPct: node.baselineCompletionPct,
      measurementStatus,
      confidencePct,
      effectiveRiskScore,
      evidence: nodeEvidence,
      blockers
    };
  });
}

export function rankBottlenecks(nodes: AtlasNodeScore[]): AtlasRankedSignal[] {
  return nodes
    .filter((node) => node.completionPct < 100 && node.horizon === "PHASE_1")
    .map((node) => ({
      title: node.title,
      nodeId: node.id,
      area: node.area,
      href: node.href,
      score: Math.round(((100 - node.completionPct) * 0.45) + (node.effectiveRiskScore * 0.35) + (node.businessImpactScore * 0.2) - (node.blockers.length > 0 ? 0 : 25)),
      confidencePct: node.confidencePct,
      summary: node.blockers[0]?.summary ?? `${node.title} is ${node.completionPct}% complete with ${node.effectiveRiskScore}% residual risk.`,
      supportingEvidence: node.blockers.slice(0, 3)
    }))
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
}

export function rankRisks(nodes: AtlasNodeScore[]): AtlasRankedSignal[] {
  return nodes
    .filter((node) => node.effectiveRiskScore > 0)
    .map((node) => ({
      title: node.blockers[0]?.summary ? node.title : `${node.title} risk`,
      nodeId: node.id,
      area: node.area,
      href: node.href,
      score: Math.round(node.effectiveRiskScore * 0.7 + node.businessImpactScore * 0.3),
      confidencePct: node.confidencePct,
      summary: node.blockers[0]?.summary ?? `${node.title} carries ${node.effectiveRiskScore}% residual risk until supporting evidence improves.`,
      supportingEvidence: node.blockers.slice(0, 3)
    }))
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
}

export function rankOpportunities(nodes: AtlasNodeScore[]): AtlasOpportunity[] {
  const signals = rankBottlenecks(nodes);
  return signals.map((signal, index) => {
    const node = nodes.find((item) => item.id === signal.nodeId);
    const estimatedHours = node?.estimatedHoursRemaining ?? null;
    const expectedHigh = clamp(Math.round(signal.score / Math.max(estimatedHours ?? 24, 12)), 1, 12);
    const expectedLow = Math.max(1, Math.round(expectedHigh * 0.45));
    return {
      ...signal,
      expectedProbabilityIncrease: { low: expectedLow, high: expectedHigh },
      estimatedHours,
      whyThisMatters: node
        ? `${node.title} unlocks ${node.dependencies.length > 0 ? node.dependencies.length : "direct"} dependency path(s) and has ${node.businessImpactScore}/100 business impact.`
        : "This task ranks highest by risk, impact, and incomplete dependency weight.",
      alternatives: signals.filter((_, alternativeIndex) => alternativeIndex !== index).slice(0, 3)
    };
  });
}

function buildGoalPosition(readiness: AtlasPhaseOneReadinessInput, nodeScores: AtlasNodeScore[]): AtlasGoalPosition {
  const milestoneIds = ["phase1.first-batch", "phase1.production-unit", "phase1.customer-order", "phase2.first-50-sales"];
  const milestones = milestoneIds
    .map((nodeId) => nodeScores.find((node) => node.id === nodeId))
    .filter((node): node is AtlasNodeScore => Boolean(node))
    .map((node): AtlasGoalMilestone => ({
      id: node.id,
      title: node.title,
      horizon: node.horizon,
      href: node.href,
      measurementStatus: node.measurementStatus,
      completionPct: node.completionPct,
      confidencePct: node.confidencePct,
      effectiveRiskScore: node.effectiveRiskScore,
      summary: goalMilestoneSummary(node)
    }));

  const materialState = readiness.remainingMaterialGap > 0
    ? `${readiness.remainingMaterialGap} package input unit(s) still missing`
    : "Package inputs cover the full target";
  const buildState = readiness.buildableTowardTarget > 0
    ? `${readiness.buildableTowardTarget} more package build action(s) are possible from already-built direct inputs`
    : "No additional package build action is currently possible from direct inputs";

  return {
    title: "Phase I Launch Position",
    physicalTarget: readiness,
    milestones,
    summary: `${readiness.assembledPackages}/${readiness.targetPackages} ${readiness.packageSku} unit(s) are ledger-built. ${buildState}; ${materialState}. ${readiness.bottleneckSku ? `Current physical constraint: ${readiness.bottleneckSku}.` : "No physical bottleneck is currently named."}`
  };
}

function goalMilestoneSummary(node: AtlasNodeScore) {
  if (node.measurementStatus === "MEASURED") {
    return `${node.completionPct}% evidence-measured · ${node.effectiveRiskScore}% residual risk · ${node.confidencePct}% confidence.`;
  }
  if (node.measurementStatus === "STALE") {
    return `Measurement is stale; Atlas will not treat the old signal as current progress. ${node.effectiveRiskScore}% residual risk.`;
  }
  return `No current completion measurement. The ${node.planningBaselineCompletionPct}% planning baseline remains context only, not progress proof.`;
}

function summarizeRadar(nodes: AtlasNodeScore[]): AtlasRadarSector[] {
  const areas: AtlasArea[] = ["Engineering", "Manufacturing", "Brand", "Operations", "Customer Validation", "Finance", "Execution"];
  return areas.map((area) => {
    const areaNodes = nodes.filter((node) => node.area === area || (area === "Engineering" && ["Firmware", "Electronics"].includes(node.area)));
    if (areaNodes.length === 0) {
      return { area, scorePct: 0, confidencePct: 0, riskPct: 0, status: "unknown", summary: "No Atlas evidence has been mapped to this area yet." };
    }
    const scorePct = weightedAverage(areaNodes, (node) => node.completionPct, (node) => node.weight);
    const confidencePct = weightedAverage(areaNodes, (node) => node.confidencePct, (node) => node.weight);
    const riskPct = weightedAverage(areaNodes, (node) => node.effectiveRiskScore, (node) => node.weight);
    return {
      area,
      scorePct,
      confidencePct,
      riskPct,
      status: confidencePct < 35 ? "unknown" : scorePct < 35 || riskPct > 65 ? "weak" : scorePct < 65 || riskPct > 45 ? "watch" : "strong",
      summary: `${scorePct}% complete, ${riskPct}% residual risk, ${confidencePct}% evidence confidence.`
    };
  });
}

function summarizeEvidenceCoverage(nodes: AtlasNode[], evidence: AtlasEvidence[], confidencePct: number, now: Date): AtlasEvidenceCoverage {
  const coveredNodes = new Set(evidence.map((item) => item.nodeId));
  const sources = new Set(evidence.map((item) => item.sourceType.toLowerCase()));
  const staleEvidenceCount = evidence.filter((item) => isStaleEvidence(item, now)).length;
  const missingCriticalSources = CRITICAL_SOURCE_LABELS.filter((source) => !sources.has(source));
  return {
    sourceCount: sources.size,
    nodeCoveragePct: clamp(Math.round((coveredNodes.size / Math.max(nodes.length, 1)) * 100), 0, 100),
    weightedNodeCoveragePct: weightedCoverage(nodes, coveredNodes),
    phaseOneWeightedCoveragePct: weightedCoverage(nodes.filter((node) => node.horizon === "PHASE_1"), coveredNodes),
    staleEvidenceCount,
    confidencePct: clamp(confidencePct - Math.min(25, staleEvidenceCount * 3), 0, 100),
    missingCriticalSources
  };
}

function weightedCoverage(nodes: AtlasNode[], coveredNodeIds: Set<string>) {
  const totalWeight = nodes.reduce((total, node) => total + Math.max(node.weight, 0), 0);
  if (totalWeight <= 0) return 0;
  const coveredWeight = nodes.reduce((total, node) => total + (coveredNodeIds.has(node.id) ? Math.max(node.weight, 0) : 0), 0);
  return clamp(Math.round((coveredWeight / totalWeight) * 100), 0, 100);
}

export function summarizeMomentum(activityEvents: AtlasActivityEvent[], now: Date): AtlasMomentumSummary {
  if (activityEvents.length === 0) {
    return {
      dailyDeepWorkHours: null,
      weeklyDeepWorkHours: null,
      monthlyDeepWorkHours: null,
      dailyTotalHours: null,
      weeklyWorkHistory: [],
      dailySectorWork: [],
      executionRatio: null,
      learningRatio: null,
      planningRatio: null,
      distractionRatio: null,
      averageFocusMinutes: null,
      contextSwitches: null,
      velocityTrend: "unknown",
      confidencePct: 10,
      classificationCounts: { work: 0, idle: 0, distraction: 0, uncertain: 0 },
      note: "No Founder OS activity blocks are available yet. The dashboard leaves work metrics unknown rather than estimating them."
    };
  }

  const measuredEvents = activityEvents.filter(isMeasuredActivityEvent);
  const totalHours = measuredEvents.reduce((total, event) => total + eventDurationHours(event), 0);
  const todaysClassifiedEvents = activityEvents.filter((event) => isSameAtlasDay(new Date(event.startedAt), now));
  const todaysEvents = todaysClassifiedEvents.filter(isWorkActivityEvent);
  const dailyTotalHours = todaysEvents.reduce((total, event) => total + eventDurationHours(event), 0);
  const dailyDeepWorkHours = todaysEvents.filter((event) => event.leverageTier === "HIGH").reduce((total, event) => total + eventDurationHours(event), 0);
  const executionHours = measuredEvents.filter((event) => ["Engineering", "Firmware", "Manufacturing", "Supplier Communication", "Marketing", "Customer Development"].includes(event.category)).reduce((total, event) => total + eventDurationHours(event), 0);
  const learningHours = measuredEvents.filter((event) => ["Learning", "Research"].includes(event.category)).reduce((total, event) => total + eventDurationHours(event), 0);
  const planningHours = measuredEvents.filter((event) => event.category === "Planning").reduce((total, event) => total + eventDurationHours(event), 0);
  const distractionHours = measuredEvents.filter((event) => event.category === "Distraction").reduce((total, event) => total + eventDurationHours(event), 0);
  const weeklyEvents = activityEvents.filter((event) => occursWithinDays(event, now, 7));
  const previousWeekEvents = activityEvents.filter((event) => occursWithinRange(event, now, 14, 7));
  const monthlyEvents = activityEvents.filter((event) => occursWithinDays(event, now, 30));
  const weeklyDeepWorkHours = highLeverageHours(weeklyEvents);
  const previousWeekDeepWorkHours = highLeverageHours(previousWeekEvents);
  const monthlyDeepWorkHours = highLeverageHours(monthlyEvents);
  const workSessions = summarizeWorkSessions(measuredEvents);

  return {
    dailyDeepWorkHours: dailyDeepWorkHours > 0 ? roundOne(dailyDeepWorkHours) : null,
    weeklyDeepWorkHours: weeklyDeepWorkHours > 0 ? roundOne(weeklyDeepWorkHours) : null,
    monthlyDeepWorkHours: monthlyDeepWorkHours > 0 ? roundOne(monthlyDeepWorkHours) : null,
    dailyTotalHours: dailyTotalHours > 0 ? roundOne(dailyTotalHours) : null,
    weeklyWorkHistory: [],
    dailySectorWork: summarizeDailySectorWork(todaysEvents),
    executionRatio: ratio(executionHours, totalHours),
    learningRatio: ratio(learningHours, totalHours),
    planningRatio: ratio(planningHours, totalHours),
    distractionRatio: ratio(distractionHours, totalHours),
    averageFocusMinutes: workSessions.length > 0 ? Math.round(average(workSessions.map((session) => session.durationMinutes))) : null,
    contextSwitches: Math.max(workSessions.length - 1, 0),
    velocityTrend: velocityTrend(weeklyDeepWorkHours, previousWeekDeepWorkHours),
    confidencePct: Math.round(average((todaysClassifiedEvents.length > 0 ? todaysClassifiedEvents : activityEvents).map((event) => event.confidencePct))),
    classificationCounts: summarizeActivityClassifications(todaysClassifiedEvents),
    note: "Momentum uses distinct current-day, rolling-7-day, and rolling-30-day windows. Today’s block counts and work metrics include only direct-evidence work; idle, distraction, and uncertain blocks are excluded."
  };
}

function occursWithinDays(event: AtlasActivityEvent, now: Date, days: number) {
  return occursWithinRange(event, now, days, 0);
}

function occursWithinRange(event: AtlasActivityEvent, now: Date, olderDays: number, newerDays: number) {
  const startedAt = new Date(event.startedAt).getTime();
  const nowMs = now.getTime();
  return Number.isFinite(startedAt) && startedAt >= nowMs - olderDays * 86_400_000 && startedAt < nowMs - newerDays * 86_400_000;
}

function highLeverageHours(events: AtlasActivityEvent[]) {
  return events.filter((event) => event.leverageTier === "HIGH" && event.validatedProgress).reduce((total, event) => total + eventDurationHours(event), 0);
}

function velocityTrend(currentHours: number, previousHours: number): AtlasMomentumSummary["velocityTrend"] {
  if (currentHours <= 0 || previousHours <= 0) return "unknown";
  if (currentHours >= previousHours * 1.2) return "accelerating";
  if (currentHours <= previousHours * 0.8) return "regressing";
  return "stable";
}

function summarizeWorkSessions(events: AtlasActivityEvent[]) {
  // The Founder OS exporter can emit minute-scale category samples. Treat category churn inside
  // a continuous work stretch as classifier noise, not hundreds of founder context switches.
  const sessions: Array<{ endedAt: number; durationMinutes: number }> = [];
  for (const event of [...events].sort((left, right) => new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime())) {
    const startedAt = new Date(event.startedAt).getTime();
    const endedAt = new Date(event.endedAt).getTime();
    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) continue;
    const prior = sessions.at(-1);
    if (prior && startedAt - prior.endedAt <= 10 * 60_000) {
      prior.durationMinutes += (endedAt - Math.max(startedAt, prior.endedAt)) / 60_000;
      prior.endedAt = Math.max(prior.endedAt, endedAt);
      continue;
    }
    sessions.push({ endedAt, durationMinutes: (endedAt - startedAt) / 60_000 });
  }
  return sessions;
}

function summarizeDailySectorWork(activityEvents: AtlasActivityEvent[]): AtlasDailySectorWork[] {
  const grouped = groupBy(activityEvents, (event) => event.category);
  return Array.from(grouped.entries())
    .map(([sector, events]) => {
      const hours = events.reduce((total, event) => total + eventDurationHours(event), 0);
      const highLeverageHours = events.filter((event) => event.leverageTier === "HIGH").reduce((total, event) => total + eventDurationHours(event), 0);
      return {
        sector: sector as AtlasDailySectorWork["sector"],
        hours: roundOne(hours),
        highLeverageHours: roundOne(highLeverageHours),
        eventCount: events.length,
        confidencePct: Math.round(average(events.map((event) => event.confidencePct)))
      };
    })
    .filter((item) => item.hours > 0)
    .sort((left, right) => right.hours - left.hours || left.sector.localeCompare(right.sector));
}

function isMeasuredActivityEvent(event: AtlasActivityEvent) {
  return event.activityClassification ? event.activityClassification === "WORK" : event.category !== "Unknown";
}

function isWorkActivityEvent(event: AtlasActivityEvent) {
  return isMeasuredActivityEvent(event) && event.category !== "Distraction" && event.leverageTier !== "LOW";
}

function summarizeActivityClassifications(events: AtlasActivityEvent[]) {
  return events.reduce((counts, event) => {
    const classification = event.activityClassification
      ?? (event.category === "Distraction" ? "DISTRACTION" : event.category === "Unknown" ? "UNCERTAIN" : "WORK");
    if (classification === "WORK") counts.work += 1;
    else if (classification === "IDLE") counts.idle += 1;
    else if (classification === "DISTRACTION") counts.distraction += 1;
    else counts.uncertain += 1;
    return counts;
  }, { work: 0, idle: 0, distraction: 0, uncertain: 0 });
}

function isSameAtlasDay(left: Date, right: Date) {
  if (!Number.isFinite(left.getTime()) || !Number.isFinite(right.getTime())) return false;
  return atlasDayKey(left) === atlasDayKey(right);
}

function atlasDayKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function buildRealityStatement(input: { coverage: AtlasEvidenceCoverage; highestLeverageTask: AtlasOpportunity | null; largestRisk: AtlasRankedSignal | null; activityEvents: AtlasActivityEvent[] }) {
  if (input.coverage.confidencePct < 45) {
    return `Atlas is operational, but evidence coverage is still sparse (${input.coverage.nodeCoveragePct}% node coverage). The next best move is to improve shipping-critical evidence rather than trust precise forecasts.`;
  }
  const measuredEvents = input.activityEvents.filter(isMeasuredActivityEvent);
  const lowLeverageHours = measuredEvents.filter((event) => event.leverageTier === "LOW").reduce((total, event) => total + eventDurationHours(event), 0);
  const totalHours = measuredEvents.reduce((total, event) => total + eventDurationHours(event), 0);
  if (totalHours > 0 && lowLeverageHours / totalHours > 0.35 && input.highestLeverageTask) {
    return `Low-leverage work accounts for ${Math.round((lowLeverageHours / totalHours) * 100)}% of classified time while ${input.highestLeverageTask.title} remains the highest expected-return move.`;
  }
  if (input.highestLeverageTask) {
    return `${input.highestLeverageTask.title} is currently the highest-leverage move because it combines launch dependency weight, residual risk, and business impact.`;
  }
  return input.largestRisk ? `${input.largestRisk.title} is the clearest risk signal. Atlas needs more evidence before ranking a specific opportunity.` : "No major blocker is ranked yet; Atlas needs more evidence.";
}

function buildCounterfactuals(input: { remainingHours: number | null; weeklyVelocity: { currentHours: number | null; requiredHours: number | null }; highestLeverageTask: AtlasOpportunity | null; launchProbability: AtlasProbabilityInterval }) {
  const counterfactuals = [];
  const hasCredibleVelocity = input.weeklyVelocity.currentHours != null && input.weeklyVelocity.currentHours >= 2;
  if (input.remainingHours && input.weeklyVelocity.currentHours && hasCredibleVelocity) {
    const currentDays = Math.ceil((input.remainingHours / input.weeklyVelocity.currentHours) * 7);
    const improvedDays = Math.ceil((input.remainingHours / Math.max(input.weeklyVelocity.currentHours + 8, 1)) * 7);
    counterfactuals.push(`At the current validated execution rate, remaining Phase I work projects to roughly ${currentDays} days; adding 8 focused execution hours/week would reduce that to roughly ${improvedDays} days, assuming the same blockers clear.`);
  } else if (input.weeklyVelocity.currentHours != null) {
    counterfactuals.push(`Atlas is now reading Founder OS passive activity coverage, but the current validated high-leverage sample is only ${input.weeklyVelocity.currentHours}h. It needs at least ~2h in the current window before projecting a credible activity-velocity date.`);
  } else {
    counterfactuals.push("Atlas cannot yet project a credible date from activity velocity because passive/validated activity coverage is not enabled.");
  }
  if (input.highestLeverageTask) {
    counterfactuals.push(`Completing ${input.highestLeverageTask.title} is estimated to improve launch probability by ${input.highestLeverageTask.expectedProbabilityIncrease.low}–${input.highestLeverageTask.expectedProbabilityIncrease.high} points before calibration.`);
  }
  counterfactuals.push(`Current launch probability interval is ${input.launchProbability.low}–${input.launchProbability.high}% because Atlas widens uncertainty when evidence coverage is incomplete.`);
  return counterfactuals;
}

function projectLaunchDate(input: { now: Date; remainingHours: number | null; weeklyHours: number | null; confidencePct: number }): AtlasProjectedDate {
  if (!input.remainingHours || !input.weeklyHours || input.weeklyHours < 2) {
    return { low: null, p50: null, high: null, confidencePct: input.confidencePct };
  }
  const p50Days = Math.ceil((input.remainingHours / input.weeklyHours) * 7);
  const spreadDays = input.confidencePct >= 70 ? 10 : input.confidencePct >= 45 ? 21 : 45;
  return {
    low: addDays(input.now, Math.max(1, p50Days - spreadDays)).toISOString().slice(0, 10),
    p50: addDays(input.now, p50Days).toISOString().slice(0, 10),
    high: addDays(input.now, p50Days + spreadDays).toISOString().slice(0, 10),
    confidencePct: input.confidencePct
  };
}

function estimateWeeklyVelocity(activityEvents: AtlasActivityEvent[], remainingHours: number | null, now: Date) {
  const validatedHours = activityEvents
    .filter((event) => occursWithinDays(event, now, 7) && event.validatedProgress && event.leverageTier === "HIGH")
    .reduce((total, event) => total + eventDurationHours(event), 0);
  const currentHours = validatedHours > 0 ? roundOne(validatedHours) : null;
  return {
    currentHours,
    requiredHours: remainingHours ? Math.ceil(remainingHours / 8) : null,
    confidencePct: currentHours ? currentHours >= 2 ? 55 : 25 : 10
  };
}

function estimateRemainingHours(nodes: AtlasNodeScore[]) {
  const hours = nodes.reduce((total, node) => total + ((node.estimatedHoursRemaining ?? 0) * ((100 - node.completionPct) / 100)), 0);
  return hours > 0 ? Math.ceil(hours) : null;
}

function burnoutRisk(activityEvents: AtlasActivityEvent[], confidencePct: number): AtlasProbabilityInterval {
  const measuredEvents = activityEvents.filter(isMeasuredActivityEvent);
  if (measuredEvents.length === 0) return interval(35, 28, 15);
  const totalHours = measuredEvents.reduce((total, event) => total + eventDurationHours(event), 0);
  const p50 = totalHours > 60 ? 72 : totalHours > 45 ? 55 : totalHours < 15 ? 38 : 30;
  return interval(p50, 16, confidencePct);
}

function riskInterval(riskP50: number, confidencePct: number) {
  return interval(clamp(Math.round(riskP50), 1, 95), confidencePct >= 60 ? 10 : 20, confidencePct);
}

function interval(p50: number, width: number, confidencePct: number): AtlasProbabilityInterval {
  return { low: clamp(p50 - width, 0, 100), p50: clamp(p50, 0, 100), high: clamp(p50 + width, 0, 100), confidencePct: clamp(Math.round(confidencePct), 0, 100) };
}

function adjustProbabilityForNode(base: number, node: AtlasNodeScore | undefined, adjustment: number) {
  if (!node) return base + adjustment;
  return clamp(Math.round((base * 0.65) + (node.completionPct * 0.35) + adjustment - (node.effectiveRiskScore * 0.08)), 1, 95);
}

function findNode(nodes: AtlasNodeScore[], id: string) {
  return nodes.find((node) => node.id === id);
}

function evidenceConfidence(evidence: AtlasEvidence[], nodes: AtlasNodeScore[], now: Date) {
  if (evidence.length === 0) return 25;
  const sourceCount = new Set(evidence.map((item) => item.sourceType)).size;
  const coveragePct = Math.round((new Set(evidence.map((item) => item.nodeId)).size / Math.max(nodes.length, 1)) * 100);
  const stalePenalty = Math.min(25, evidence.filter((item) => isStaleEvidence(item, now)).length * 3);
  return clamp(Math.round(average(evidence.map((item) => item.confidencePct)) * 0.65 + coveragePct * 0.2 + Math.min(sourceCount * 5, 15) - stalePenalty), 0, 100);
}

export function isStaleEvidence(evidence: AtlasEvidence, now: Date = new Date()) {
  const observedAt = new Date(evidence.observedAt).getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(observedAt) || !Number.isFinite(nowMs)) return true;
  if (observedAt > nowMs + 3_600_000) return true;
  const ageDays = (nowMs - observedAt) / 86_400_000;
  return ageDays > staleAfterDays(evidence.sourceType);
}

function staleAfterDays(sourceType: AtlasEvidence["sourceType"]) {
  if (sourceType === "TRACKING") return 3;
  if (sourceType === "AUTOMATION") return 7;
  if (sourceType === "INVENTORY" || sourceType === "BOM") return 7;
  if (sourceType === "PURCHASING" || sourceType === "EMAIL") return 14;
  if (sourceType === "ACCOUNTING") return 30;
  return 30;
}

function eventDurationHours(event: AtlasActivityEvent) {
  if (Number.isFinite(event.durationHours) && Number(event.durationHours) >= 0) return Number(event.durationHours);
  const startedAt = new Date(event.startedAt).getTime();
  const endedAt = new Date(event.endedAt).getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) return 0;
  return (endedAt - startedAt) / 3_600_000;
}

function ratio(value: number, total: number) {
  return total > 0 ? roundOne(value / total) : null;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return grouped;
}

function weightedAverage<T>(items: T[], valueFn: (item: T) => number, weightFn: (item: T) => number) {
  const totalWeight = items.reduce((total, item) => total + Math.max(weightFn(item), 0), 0);
  if (totalWeight <= 0) return 0;
  return Math.round(items.reduce((total, item) => total + valueFn(item) * Math.max(weightFn(item), 0), 0) / totalWeight);
}

function average(values: number[]) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (filtered.length === 0) return 0;
  return filtered.reduce((total, value) => total + value, 0) / filtered.length;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
