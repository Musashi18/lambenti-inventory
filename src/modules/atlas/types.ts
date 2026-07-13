export type AtlasHorizon = "PHASE_1" | "PHASE_2" | "PHASE_3" | "PHASE_4";

export type AtlasArea =
  | "Engineering"
  | "Firmware"
  | "Electronics"
  | "Industrial Design"
  | "Manufacturing"
  | "Supplier Communication"
  | "Brand"
  | "Website"
  | "Marketing"
  | "Finance"
  | "Inventory"
  | "Customer Validation"
  | "Operations"
  | "Execution"
  | "Planning";

export type AtlasNodeKind = "COMPANY" | "HORIZON" | "PROJECT" | "WORKSTREAM" | "MILESTONE" | "RISK" | "TASK";
export type AtlasNodeStatus = "NOT_STARTED" | "ACTIVE" | "BLOCKED" | "COMPLETE" | "PAUSED";

export type AtlasSourceType =
  | "INVENTORY"
  | "BOM"
  | "PURCHASING"
  | "TRACKING"
  | "ACCOUNTING"
  | "AUTOMATION"
  | "GIT"
  | "FILE"
  | "HERMES_MEMORY"
  | "CALENDAR"
  | "EMAIL"
  | "MANUAL"
  | "EXTERNAL_ANALYTICS";

export type AtlasActivityCategory =
  | "Engineering"
  | "Firmware"
  | "Industrial Design"
  | "Manufacturing"
  | "Supplier Communication"
  | "Marketing"
  | "Content Creation"
  | "Finance"
  | "Planning"
  | "Research"
  | "Learning"
  | "Administration"
  | "Meetings"
  | "Customer Development"
  | "Distraction"
  | "Unknown";

export type AtlasLeverageTier = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

/** Conservative interpretation of a passive Founder OS block before it reaches metrics. */
export type FounderOsActivityClassification = "WORK" | "IDLE" | "DISTRACTION" | "UNCERTAIN";

export type AtlasNode = {
  id: string;
  title: string;
  kind: AtlasNodeKind;
  horizon: AtlasHorizon;
  area: AtlasArea;
  dependencies: string[];
  baselineCompletionPct: number;
  weight: number;
  status: AtlasNodeStatus;
  estimatedHoursRemaining: number | null;
  businessImpactScore: number;
  riskScore: number;
  href?: string;
};

export type AtlasEvidence = {
  id: string;
  nodeId: string;
  sourceType: AtlasSourceType;
  sourceRef: string;
  summary: string;
  confidencePct: number;
  observedAt: string;
  href?: string;
  completionPct?: number;
  impactScore?: number;
  riskScore?: number;
  estimatedHours?: number;
  validatedProgress?: boolean;
};

export type AtlasActivityEvent = {
  id: string;
  nodeId?: string;
  category: AtlasActivityCategory;
  leverageTier: AtlasLeverageTier;
  confidencePct: number;
  startedAt: string;
  endedAt: string;
  durationHours?: number;
  summary: string;
  sourceType: AtlasSourceType;
  sourceRef: string;
  validatedProgress: boolean;
  progressContributionPct?: number;
  /** Omitted only by legacy/manual callers; parsed Founder OS blocks always set it. */
  activityClassification?: FounderOsActivityClassification;
};

export type AtlasNodeScore = AtlasNode & {
  /** A current operational measurement. Planning baselines never count as measured progress. */
  completionPct: number;
  evidenceCompletionPct: number | null;
  planningBaselineCompletionPct: number;
  measurementStatus: "MEASURED" | "UNMEASURED" | "STALE";
  confidencePct: number;
  effectiveRiskScore: number;
  evidence: AtlasEvidence[];
  blockers: AtlasEvidence[];
};

export type AtlasRankedSignal = {
  title: string;
  nodeId: string;
  area: AtlasArea;
  href?: string;
  score: number;
  confidencePct: number;
  summary: string;
  supportingEvidence: AtlasEvidence[];
};

export type AtlasOpportunity = AtlasRankedSignal & {
  expectedProbabilityIncrease: { low: number; high: number };
  estimatedHours: number | null;
  whyThisMatters: string;
  alternatives: AtlasRankedSignal[];
};

export type AtlasProbabilityInterval = {
  low: number;
  p50: number;
  high: number;
  confidencePct: number;
};

export type AtlasProjectedDate = {
  low: string | null;
  p50: string | null;
  high: string | null;
  confidencePct: number;
};

export type AtlasRadarSector = {
  area: AtlasArea;
  scorePct: number;
  confidencePct: number;
  riskPct: number;
  status: "strong" | "watch" | "weak" | "unknown";
  summary: string;
};

export type AtlasDailySectorWork = {
  sector: AtlasActivityCategory;
  hours: number;
  highLeverageHours: number;
  eventCount: number;
  confidencePct: number;
};

export type AtlasWeeklyWorkHours = {
  /** Sunday 00:00 in the stated timezone, serialized as a calendar ISO date. */
  weekStart: string;
  weekEnd: string;
  label: string;
  workedHours: number;
  highLeverageHours: number;
  workBlockCount: number;
  sourceBlockCount: number;
  isCurrentWeek: boolean;
  /** True when this total has been durably recorded in FounderActivityWeek. */
  recorded: boolean;
};

export type AtlasMomentumSummary = {
  dailyDeepWorkHours: number | null;
  weeklyDeepWorkHours: number | null;
  monthlyDeepWorkHours: number | null;
  dailyTotalHours: number | null;
  weeklyWorkHistory: AtlasWeeklyWorkHours[];
  dailySectorWork: AtlasDailySectorWork[];
  executionRatio: number | null;
  learningRatio: number | null;
  planningRatio: number | null;
  distractionRatio: number | null;
  averageFocusMinutes: number | null;
  contextSwitches: number | null;
  velocityTrend: "accelerating" | "stable" | "regressing" | "unknown";
  confidencePct: number;
  /** Current-day block counts, matching the dashboard's daily work breakdown. */
  classificationCounts: {
    work: number;
    idle: number;
    distraction: number;
    uncertain: number;
  };
  note: string;
};

export type AtlasGraphDto = {
  nodes: AtlasNodeScore[];
  dependencies: Array<{ from: string; to: string }>;
};

export type AtlasEvidenceCoverage = {
  sourceCount: number;
  nodeCoveragePct: number;
  weightedNodeCoveragePct: number;
  phaseOneWeightedCoveragePct: number;
  staleEvidenceCount: number;
  confidencePct: number;
  missingCriticalSources: string[];
};

/** Exact, read-only Phase I package-readiness facts from the operational dashboard. */
export type AtlasPhaseOneReadinessInput = {
  packageSku: string;
  packageDescription: string;
  packageDisplayName: string;
  targetPackages: number;
  assembledPackages: number;
  buildCapacityNow: number;
  buildableTowardTarget: number;
  materialCoverageNow: number;
  materialCoveredTowardTarget: number;
  remainingBuildGap: number;
  remainingMaterialGap: number;
  bottleneckSku: string;
  status: "BLOCKED" | "IN_PROGRESS" | "BUILD_READY" | "COVERED";
  nextActions: Array<{ label: string; reason: string; href: string }>;
};

export type AtlasGoalMilestone = {
  id: string;
  title: string;
  horizon: AtlasHorizon;
  href?: string;
  measurementStatus: AtlasNodeScore["measurementStatus"];
  completionPct: number;
  confidencePct: number;
  effectiveRiskScore: number;
  summary: string;
};

/**
 * Atlas' explicit answer to "where are we against the larger launch goal?".
 * Physical package numbers come only from the ledger/BOM readiness summary; graph stages remain
 * evidence-backed and can remain unmeasured without being represented as zero progress.
 */
export type AtlasGoalPosition = {
  title: string;
  physicalTarget: AtlasPhaseOneReadinessInput;
  milestones: AtlasGoalMilestone[];
  summary: string;
};

export type AtlasMissionControl = {
  /** Evidence-backed Phase I progress. This excludes static planning baselines. */
  missionCompletionPct: number;
  /** Evidence-backed progress across the entire mapped company graph. */
  companyCompletionPct: number;
  launchProbability: AtlasProbabilityInterval;
  firstBatchSuccessProbability: AtlasProbabilityInterval;
  customerExperienceProbability: AtlasProbabilityInterval;
  manufacturingDelayRisk: AtlasProbabilityInterval;
  cashShortageRisk: AtlasProbabilityInterval;
  burnoutRisk: AtlasProbabilityInterval;
  longTermSurvivalProbability: AtlasProbabilityInterval;
  projectedLaunchDate: AtlasProjectedDate;
  remainingHours: number | null;
  weeklyVelocity: { currentHours: number | null; requiredHours: number | null; confidencePct: number };
  currentBottleneck: AtlasRankedSignal | null;
  largestRisk: AtlasRankedSignal | null;
  highestLeverageTask: AtlasOpportunity | null;
  strategicRadar: AtlasRadarSector[];
  momentum: AtlasMomentumSummary;
  graph: AtlasGraphDto;
  evidenceCoverage: AtlasEvidenceCoverage;
  goalPosition: AtlasGoalPosition | null;
  realityStatement: string;
  counterfactuals: string[];
  generatedAt: string;
};

export type AtlasScenarioKind =
  | "FOCUS_HOURS"
  | "OUTSOURCE_PCB_ASSEMBLY"
  | "HIRE_MANUFACTURING_HELP"
  | "DELAY_PACKAGING"
  | "LAUNCH_BEFORE_PERFECTION";

export type AtlasScenarioInput = {
  kind: AtlasScenarioKind;
  focusedHoursPerDay?: number;
  addedWeeklyExecutionHours?: number;
  removedBlockerRiskPct?: number;
};

export type AtlasScenarioResult = {
  title: string;
  timelineDeltaDays: number;
  launchProbability: AtlasProbabilityInterval;
  manufacturingDelayRisk: AtlasProbabilityInterval;
  cashShortageRisk: AtlasProbabilityInterval;
  burnoutRisk: AtlasProbabilityInterval;
  estimatedCompanyValueCreation: "low" | "medium" | "high" | "unknown";
  assumptions: string[];
};
