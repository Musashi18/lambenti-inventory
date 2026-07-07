import Link from "next/link";
import { requirePermission } from "@/modules/auth/permissions";
import { buildAtlasDecisionTimeline, buildAtlasMissionControlView } from "@/modules/atlas/presentation";
import { getAtlasMissionControl } from "@/modules/atlas/service";
import type { AtlasMissionControl, AtlasNodeScore, AtlasProbabilityInterval, AtlasRadarSector, AtlasRankedSignal } from "@/modules/atlas/types";
import { AtlasProgressMap } from "./atlas-progress-map";

export const dynamic = "force-dynamic";

const ATLAS_CRITICAL_PATH_NODE_IDS = [
  "engineering.firmware",
  "engineering.electronics",
  "manufacturing.supplier-qualification",
  "inventory.phase1-coverage",
  "manufacturing.qa",
  "phase1.production-unit"
];

export default async function AtlasPage() {
  await requirePermission("atlas:view");
  const atlas = await getAtlasMissionControl();
  const atlasView = buildAtlasMissionControlView(atlas);
  const decisionTimeline = buildAtlasDecisionTimeline(atlas);

  return (
    <div className="space-y-6 bg-slate-950 pb-24 text-slate-100 lg:-m-6 lg:p-6 lg:pb-24">
      <header className="rounded-3xl border border-cyan-400/20 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.18),transparent_36%),linear-gradient(135deg,#020617,#0f172a_55%,#111827)] p-6 shadow-2xl shadow-slate-950">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-4xl">
            <div className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-200">Project Atlas · Founder Operating System</div>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">Mission Control</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
              Atlas models Lambenti as an evidence-backed dependency graph. It does not reward time alone; only verified operational evidence moves the company closer to launch.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/atlas/simulator" className="rounded-full border border-cyan-300/40 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/20">
              Open Predictive Simulator
            </Link>
            <Link href="/atlas/overlay" className="rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10">
              Open Daily Overlay
            </Link>
          </div>
        </div>
        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <CommandMetric label="Mission Completion" value={`${atlas.missionCompletionPct}%`} detail="Weighted graph progress" />
          <CommandMetric label="Launch Probability" value={formatInterval(atlas.launchProbability)} detail={`${atlas.launchProbability.confidencePct}% confidence`} />
          <CommandMetric label="Projected Launch Date" value={formatDateInterval(atlas.projectedLaunchDate)} detail="Uses validated velocity only" />
          <CommandMetric label="Remaining Hours" value={atlas.remainingHours == null ? "Unknown" : `${atlas.remainingHours}h`} detail="Phase I weighted estimate" />
        </div>
      </header>

      <AtlasCommandDock atlas={atlas} />

      <AtlasProgressMap atlas={atlasView} />

      <VisualCommandDeck atlas={atlas} />

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <MissionPanel title="Opportunity Engine" kicker="Highest expected probability gain">
          <OpportunityCard atlas={atlas} />
        </MissionPanel>
        <MissionPanel title="Reality Engine" kicker="Evidence-based, no shame, no flattery">
          <p className="text-lg leading-7 text-white">{atlas.realityStatement}</p>
          <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-900/70 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Evidence Coverage</div>
            <div className="mt-2 grid gap-3 sm:grid-cols-4">
              <MiniMetric label="Sources" value={atlas.evidenceCoverage.sourceCount.toString()} />
              <MiniMetric label="Node Coverage" value={`${atlas.evidenceCoverage.nodeCoveragePct}%`} />
              <MiniMetric label="Confidence" value={`${atlas.evidenceCoverage.confidencePct}%`} />
              <MiniMetric label="Stale Signals" value={atlas.evidenceCoverage.staleEvidenceCount.toString()} />
            </div>
            {atlas.evidenceCoverage.missingCriticalSources.length > 0 ? (
              <p className="mt-3 text-xs text-amber-200">Missing critical coverage: {atlas.evidenceCoverage.missingCriticalSources.join(", ")}.</p>
            ) : (
              <p className="mt-3 text-xs text-emerald-200">Inventory, tracking, accounting, and automation evidence are connected.</p>
            )}
            <p className="mt-3 text-xs text-slate-400">Atlas privacy tier: raw source references are withheld from display surfaces; linked workflows remain the provenance path.</p>
          </div>
        </MissionPanel>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <MissionPanel title="Current Bottleneck" kicker="Largest launch dependency drag">
          <SignalCard signal={atlas.currentBottleneck} empty="No bottleneck ranked yet." />
        </MissionPanel>
        <MissionPanel title="Largest Risk" kicker="Highest residual risk signal">
          <SignalCard signal={atlas.largestRisk} empty="No major risk ranked yet." />
        </MissionPanel>
        <MissionPanel title="Momentum Engine" kicker="Velocity without fake progress">
          <div className="grid gap-3">
            <MiniMetric label="Weekly Deep Work" value={atlas.momentum.weeklyDeepWorkHours == null ? "Unknown" : `${atlas.momentum.weeklyDeepWorkHours}h`} />
            <MiniMetric label="Execution Ratio" value={atlas.momentum.executionRatio == null ? "Unknown" : `${Math.round(atlas.momentum.executionRatio * 100)}%`} />
            <MiniMetric label="Required Weekly Velocity" value={atlas.weeklyVelocity.requiredHours == null ? "Unknown" : `${atlas.weeklyVelocity.requiredHours}h`} />
          </div>
          <DailySectorWork atlas={atlas} />
          <p className="mt-3 text-sm leading-6 text-slate-300">{atlas.momentum.note}</p>
        </MissionPanel>
      </section>

      <section className="grid gap-4 2xl:grid-cols-[0.8fr_1.2fr]">
        <MissionPanel title="Strategic Radar" kicker="Weak areas pulse by evidence and risk">
          <div className="grid gap-3 sm:grid-cols-2">
            {atlas.strategicRadar.map((sector) => <RadarSector key={sector.area} sector={sector} />)}
          </div>
        </MissionPanel>
        <MissionPanel title="Progress Galaxy" kicker="Dependency graph illumination">
          <ProgressGalaxy nodes={atlas.graph.nodes} />
        </MissionPanel>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <MissionPanel title="Company Health Model" kicker="Intervals widen when evidence is sparse">
          <div className="grid gap-3 sm:grid-cols-2">
            <HealthMetric label="First Batch Success" interval={atlas.firstBatchSuccessProbability} />
            <HealthMetric label="Customer Experience" interval={atlas.customerExperienceProbability} />
            <HealthMetric label="Manufacturing Delay Risk" interval={atlas.manufacturingDelayRisk} />
            <HealthMetric label="Cash Shortage Risk" interval={atlas.cashShortageRisk} />
            <HealthMetric label="Burnout Risk" interval={atlas.burnoutRisk} />
            <HealthMetric label="Long-Term Survival" interval={atlas.longTermSurvivalProbability} />
          </div>
        </MissionPanel>
        <MissionPanel title="Counterfactual Reasoning Engine" kicker="Assumptions shown before conclusions">
          <ul className="space-y-3 text-sm leading-6 text-slate-300">
            {atlas.counterfactuals.map((counterfactual) => (
              <li key={counterfactual} className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">{counterfactual}</li>
            ))}
          </ul>
        </MissionPanel>
      </section>

      <MissionPanel title="Decision Timeline" kicker="Why Atlas moved this way">
        <ol className="grid gap-3 lg:grid-cols-5">
          {decisionTimeline.map((entry) => (
            <li key={`${entry.label}:${entry.summary}`} className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{entry.label}</div>
              <p className="mt-2 text-sm leading-6 text-slate-300">{entry.summary}</p>
              <div className="mt-3 text-xs font-semibold text-cyan-200">{entry.confidencePct}% confidence</div>
              {entry.href ? <Link href={entry.href} className="mt-2 inline-flex text-xs font-semibold text-cyan-200 underline underline-offset-4">Open linked workflow</Link> : null}
            </li>
          ))}
        </ol>
      </MissionPanel>
    </div>
  );
}

function AtlasCommandDock({ atlas }: { atlas: AtlasMissionControl }) {
  const nextWorkflowHref = atlas.highestLeverageTask?.href ?? atlas.currentBottleneck?.href ?? atlas.largestRisk?.href ?? "/atlas/simulator";
  const nextWorkflowTitle = atlas.highestLeverageTask?.title ?? atlas.currentBottleneck?.title ?? atlas.largestRisk?.title ?? "Open Simulator";
  return (
    <section className="rounded-3xl border border-emerald-300/20 bg-[linear-gradient(135deg,rgba(7,64,71,0.62),rgba(15,23,42,0.94))] p-5 shadow-2xl shadow-slate-950/40">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-200">Atlas Command Dock</div>
          <h2 className="mt-1 text-2xl font-semibold text-white">Now, blocker, risk, trust, next workflow.</h2>
          <p className="mt-1 text-xs text-emerald-100/70">Live database read · updated {formatAtlasGeneratedAt(atlas.generatedAt)}</p>
        </div>
        <Link href={nextWorkflowHref} className="inline-flex w-fit rounded-full border border-cyan-200/40 bg-cyan-200/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-200/20">
          Open Next Workflow
        </Link>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <CommandDockCard label="Now" title={atlas.highestLeverageTask?.title ?? "Collect Stronger Evidence"} detail={atlas.highestLeverageTask?.summary ?? "Atlas needs stronger validated evidence before ranking a high-leverage next move."} href={atlas.highestLeverageTask?.href} />
        <CommandDockCard label="Blocked By" title={atlas.currentBottleneck?.title ?? "No Dominant Bottleneck"} detail={atlas.currentBottleneck?.summary ?? "No single launch dependency is currently dominating the graph."} href={atlas.currentBottleneck?.href} />
        <CommandDockCard label="Largest Risk" title={atlas.largestRisk?.title ?? "No Major Risk Ranked"} detail={atlas.largestRisk?.summary ?? "Risk ranking will strengthen as evidence coverage improves."} href={atlas.largestRisk?.href} />
        <CommandDockCard label="Trust" title={`${atlas.evidenceCoverage.confidencePct}% Evidence Confidence`} detail={`${atlas.evidenceCoverage.nodeCoveragePct}% node coverage · ${atlas.evidenceCoverage.staleEvidenceCount} stale signal${atlas.evidenceCoverage.staleEvidenceCount === 1 ? "" : "s"}. Sources: ${atlas.evidenceCoverage.sourceCount}.`} href="/atlas/overlay" />
        <CommandDockCard label="Next Workflow" title={nextWorkflowTitle} detail="Follow the linked human workflow; Atlas remains read-only and does not mutate operations." href={nextWorkflowHref} />
      </div>
    </section>
  );
}

function CommandDockCard({ label, title, detail, href }: { label: string; title: string; detail: string; href?: string }) {
  const className = "block min-h-full rounded-2xl border border-white/10 bg-slate-950/55 p-4 transition hover:border-cyan-300/40 hover:bg-cyan-300/10";
  const body = (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200">{label}</div>
      <div className="mt-2 text-sm font-semibold leading-5 text-white">{title}</div>
      <p className="mt-2 text-xs leading-5 text-slate-400">{detail}</p>
      {href ? <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200">Open workflow →</div> : null}
    </>
  );
  return href ? <Link href={href} className={className}>{body}</Link> : <div className={className}>{body}</div>;
}

function formatAtlasGeneratedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "from current source snapshot";
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function VisualCommandDeck({ atlas }: { atlas: AtlasMissionControl }) {
  const criticalPath = ATLAS_CRITICAL_PATH_NODE_IDS
    .map((nodeId) => atlas.graph.nodes.find((node) => node.id === nodeId))
    .filter(isAtlasNodeScore);

  return (
    <section className="rounded-3xl border border-cyan-400/20 bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.16),transparent_30%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(2,6,23,0.96))] p-5 shadow-2xl shadow-slate-950/50">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">Atlas Visual Command Deck</div>
          <h2 className="mt-1 text-2xl font-semibold text-white">Launch System at a Glance</h2>
        </div>
        <p className="max-w-2xl text-sm leading-6 text-slate-300">
          Visual readout of mission progress, probability bands, and the Phase I critical path. Every light is backed by existing operational evidence; no Atlas view mutates stock, accounting, purchasing, or Alibaba state.
        </p>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[320px_1fr]">
        <MissionOrbit atlas={atlas} />
        <div className="grid gap-5 2xl:grid-cols-2">
          <CriticalPath nodes={criticalPath} />
          <ProbabilityBands atlas={atlas} />
        </div>
      </div>
    </section>
  );
}

function MissionOrbit({ atlas }: { atlas: AtlasMissionControl }) {
  return (
    <div className="rounded-3xl border border-slate-700/80 bg-slate-950/70 p-5">
      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Mission Orbit</div>
      <div className="mt-5 flex justify-center">
        <div className="relative flex h-64 w-64 items-center justify-center rounded-full border border-cyan-300/20 bg-slate-950 shadow-inner shadow-cyan-950/40">
          <div
            className="absolute inset-0 rounded-full opacity-90"
            style={{ background: `conic-gradient(#22d3ee ${clampPercent(atlas.missionCompletionPct)}%, rgba(30,41,59,0.85) 0)` }}
            aria-label="Mission completion orbit"
          />
          <div className="absolute inset-7 rounded-full bg-slate-950" />
          <div
            className="absolute inset-10 rounded-full opacity-80"
            style={{ background: `conic-gradient(#34d399 ${clampPercent(atlas.launchProbability.p50)}%, rgba(15,23,42,0.88) 0)` }}
            aria-label="Launch probability orbit"
          />
          <div className="absolute inset-16 rounded-full bg-slate-950" />
          <div className="relative text-center">
            <div className="text-5xl font-semibold text-white">{atlas.missionCompletionPct}%</div>
            <div className="mt-1 text-xs uppercase tracking-[0.22em] text-cyan-200">Mission</div>
            <div className="mt-3 text-sm text-emerald-200">P50 Launch {atlas.launchProbability.p50}%</div>
          </div>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 text-xs text-slate-300">
        <LegendDot label="Mission Completion" tone="cyan" value={`${atlas.missionCompletionPct}%`} />
        <LegendDot label="Launch P50" tone="emerald" value={`${atlas.launchProbability.p50}%`} />
        <LegendDot label="Evidence Confidence" tone="violet" value={`${atlas.evidenceCoverage.confidencePct}%`} />
        <LegendDot label="Node Coverage" tone="amber" value={`${atlas.evidenceCoverage.nodeCoveragePct}%`} />
      </div>
    </div>
  );
}

function CriticalPath({ nodes }: { nodes: AtlasNodeScore[] }) {
  return (
    <div className="rounded-3xl border border-slate-700/80 bg-slate-950/70 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Critical Path</div>
          <h3 className="mt-1 text-lg font-semibold text-white">Phase I Dependency Spine</h3>
        </div>
        <div className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">{nodes.length} nodes</div>
      </div>
      <div className="mt-5 grid gap-3">
        {nodes.map((node, index) => (
          <div key={node.id} className="relative grid gap-3 rounded-2xl border border-slate-700 bg-slate-900/70 p-3 sm:grid-cols-[92px_1fr]">
            {index < nodes.length - 1 ? <div className="absolute left-[45px] top-[calc(100%-2px)] hidden h-5 w-px bg-cyan-300/30 sm:block" aria-hidden="true" /> : null}
            <div className="flex items-center gap-3 sm:block">
              <div className={`flex h-10 w-10 items-center justify-center rounded-full border text-sm font-semibold ${nodeRiskTone(node)}`}>{index + 1}</div>
              <div className="mt-0 text-xs uppercase tracking-[0.18em] text-slate-500 sm:mt-2">{formatHorizon(node.horizon)}</div>
            </div>
            <div>
              <div className="flex items-start justify-between gap-3">
                <div className="font-semibold text-white">{node.title}</div>
                <div className="text-lg font-semibold text-cyan-200">{node.completionPct}%</div>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-emerald-300 to-lime-200" style={{ width: `${clampPercent(node.completionPct)}%` }} />
              </div>
              <div className="mt-2 grid gap-2 text-xs text-slate-400 sm:grid-cols-3">
                <span>{node.dependencies.length} dependencies</span>
                <span>{node.confidencePct}% confidence</span>
                <span>{node.effectiveRiskScore}% residual risk</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProbabilityBands({ atlas }: { atlas: AtlasMissionControl }) {
  return (
    <div className="rounded-3xl border border-slate-700/80 bg-slate-950/70 p-5">
      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Probability Bands</div>
      <h3 className="mt-1 text-lg font-semibold text-white">Outcome Intervals</h3>
      <div className="mt-5 grid gap-4">
        <IntervalBand label="Launch Probability" interval={atlas.launchProbability} tone="cyan" />
        <IntervalBand label="First Batch Success" interval={atlas.firstBatchSuccessProbability} tone="emerald" />
        <IntervalBand label="Manufacturing Delay Risk" interval={atlas.manufacturingDelayRisk} tone="rose" />
        <IntervalBand label="Cash Shortage Risk" interval={atlas.cashShortageRisk} tone="amber" />
        <IntervalBand label="Burnout Risk" interval={atlas.burnoutRisk} tone="violet" />
      </div>
    </div>
  );
}

function IntervalBand({ label, interval, tone }: { label: string; interval: AtlasProbabilityInterval; tone: "cyan" | "emerald" | "amber" | "rose" | "violet" }) {
  const low = clampPercent(interval.low);
  const high = clampPercent(interval.high);
  const p50 = clampPercent(interval.p50);
  const width = Math.max(2, high - low);
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold text-white">{label}</span>
        <span className="text-slate-300">{interval.low}–{interval.high}%</span>
      </div>
      <div className="relative mt-2 h-3 rounded-full bg-slate-800">
        <div className={`absolute top-0 h-3 rounded-full ${intervalTone(tone)}`} style={{ left: `${low}%`, width: `${width}%` }} />
        <div className="absolute -top-1 h-5 w-1 rounded-full bg-white shadow-lg shadow-white/20" style={{ left: `${p50}%`, transform: "translateX(-50%)" }} aria-label={`${label} P50 marker`} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] uppercase tracking-wide text-slate-500">
        <span>0</span>
        <span>P50 {interval.p50}% · {interval.confidencePct}% confidence</span>
        <span>100</span>
      </div>
    </div>
  );
}

function LegendDot({ label, tone, value }: { label: string; tone: "cyan" | "emerald" | "violet" | "amber"; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-2xl border border-slate-800 bg-slate-900/60 px-3 py-2">
      <span className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${legendTone(tone)}`} />{label}</span>
      <span className="font-semibold text-white">{value}</span>
    </div>
  );
}

function CommandMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-inner shadow-white/5">
      <div className="text-xs uppercase tracking-[0.22em] text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{detail}</div>
    </div>
  );
}

function MissionPanel({ title, kicker, children }: { title: string; kicker: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl shadow-slate-950/40">
      <div className="mb-4">
        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300/80">{kicker}</div>
        <h2 className="mt-1 text-xl font-semibold text-white">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function OpportunityCard({ atlas }: { atlas: AtlasMissionControl }) {
  const opportunity = atlas.highestLeverageTask;
  if (!opportunity) return <p className="text-sm text-slate-400">Atlas needs more evidence before ranking a next task.</p>;
  return (
    <div className="space-y-4">
      <div>
        <div className="text-2xl font-semibold text-white">{opportunity.title}</div>
        <p className="mt-2 text-sm leading-6 text-slate-300">{opportunity.summary}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <MiniMetric label="Expected Lift" value={`+${opportunity.expectedProbabilityIncrease.low}–${opportunity.expectedProbabilityIncrease.high} pts`} />
        <MiniMetric label="Estimated Time" value={opportunity.estimatedHours == null ? "Unknown" : `${opportunity.estimatedHours}h`} />
        <MiniMetric label="Confidence" value={`${opportunity.confidencePct}%`} />
      </div>
      <p className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4 text-sm leading-6 text-cyan-100">{opportunity.whyThisMatters}</p>
      {opportunity.href ? <Link className="inline-flex text-sm font-semibold text-cyan-200 underline underline-offset-4" href={opportunity.href}>Open linked workflow</Link> : null}
    </div>
  );
}

function SignalCard({ signal, empty }: { signal: AtlasRankedSignal | null; empty: string }) {
  if (!signal) return <p className="text-sm text-slate-400">{empty}</p>;
  return (
    <div>
      <div className="text-lg font-semibold text-white">{signal.title}</div>
      <p className="mt-2 text-sm leading-6 text-slate-300">{signal.summary}</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <MiniMetric label="Score" value={signal.score.toString()} />
        <MiniMetric label="Confidence" value={`${signal.confidencePct}%`} />
      </div>
      {signal.supportingEvidence.length > 0 ? (
        <ul className="mt-4 space-y-2 text-xs text-slate-400">
          {signal.supportingEvidence.map((item) => <li key={item.id}>• {item.summary}</li>)}
        </ul>
      ) : null}
      {signal.href ? <Link className="mt-4 inline-flex text-sm font-semibold text-cyan-200 underline underline-offset-4" href={signal.href}>Open evidence source</Link> : null}
    </div>
  );
}

function DailySectorWork({ atlas }: { atlas: AtlasMissionControl }) {
  const dailySectorWork = atlas.momentum.dailySectorWork;
  return (
    <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Today&apos;s Work by Sector</div>
          <div className="mt-1 text-sm text-slate-300">Classified non-idle activity, grouped by Atlas sector.</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold text-white">{atlas.momentum.dailyTotalHours == null ? "—" : `${atlas.momentum.dailyTotalHours}h`}</div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Worked Today</div>
        </div>
      </div>
      {dailySectorWork.length > 0 ? (
        <div className="mt-4 space-y-3">
          {dailySectorWork.slice(0, 4).map((sector) => (
            <div key={sector.sector}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold text-white">{sector.sector}</span>
                <span className="text-slate-300">{sector.hours}h · {sector.eventCount} block{sector.eventCount === 1 ? "" : "s"}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800" aria-label={`${sector.sector} work today`}>
                <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-300" style={{ width: `${dailyWorkWidth(sector.hours, atlas.momentum.dailyTotalHours)}%` }} />
              </div>
              <div className="mt-1 text-[11px] uppercase tracking-wide text-slate-500">{sector.highLeverageHours}h high leverage · {sector.confidencePct}% confidence</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm leading-6 text-slate-400">No classified activity blocks are available for today yet.</p>
      )}
    </div>
  );
}

function RadarSector({ sector }: { sector: AtlasRadarSector }) {
  return (
    <div className={`rounded-2xl border p-4 ${sectorTone(sector.status)}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="font-semibold text-white">{sector.area}</div>
        <div className="text-xs uppercase tracking-wide text-slate-400">{sector.status}</div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-cyan-300" style={{ width: `${sector.scorePct}%` }} />
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-300">{sector.summary}</p>
    </div>
  );
}

function ProgressGalaxy({ nodes }: { nodes: AtlasNodeScore[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {nodes.map((node) => (
        <div key={node.id} className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{formatHorizon(node.horizon)} · {node.area}</div>
              <div className="mt-1 font-semibold text-white">{node.title}</div>
            </div>
            <div className="text-lg font-semibold text-cyan-200">{node.completionPct}%</div>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800" aria-label={`${node.title} completion`}>
            <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-300" style={{ width: `${node.completionPct}%`, opacity: Math.max(0.35, node.confidencePct / 100) }} />
          </div>
          <div className="mt-2 flex justify-between text-xs text-slate-500">
            <span>{node.dependencies.length} dependencies</span>
            <span>{node.confidencePct}% confidence</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function HealthMetric({ label, interval }: { label: string; interval: AtlasProbabilityInterval }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
      <div className="text-sm font-semibold text-white">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-cyan-100">{formatInterval(interval)}</div>
      <div className="mt-1 text-xs text-slate-500">P50 {interval.p50}% · confidence {interval.confidencePct}%</div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function sectorTone(status: AtlasRadarSector["status"]) {
  if (status === "strong") return "border-emerald-400/30 bg-emerald-400/10";
  if (status === "watch") return "border-amber-400/30 bg-amber-400/10";
  if (status === "weak") return "border-rose-400/30 bg-rose-400/10";
  return "border-slate-700 bg-slate-950/60";
}

function isAtlasNodeScore(node: AtlasNodeScore | undefined): node is AtlasNodeScore {
  return node !== undefined;
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

function dailyWorkWidth(hours: number, totalHours: number | null) {
  if (!totalHours || totalHours <= 0) return 0;
  return clampPercent(Math.round((hours / totalHours) * 100));
}

function nodeRiskTone(node: AtlasNodeScore) {
  if (node.effectiveRiskScore >= 70) return "border-rose-300/50 bg-rose-400/15 text-rose-100";
  if (node.effectiveRiskScore >= 45) return "border-amber-300/50 bg-amber-400/15 text-amber-100";
  return "border-emerald-300/50 bg-emerald-400/15 text-emerald-100";
}

function intervalTone(tone: "cyan" | "emerald" | "amber" | "rose" | "violet") {
  if (tone === "emerald") return "bg-emerald-300";
  if (tone === "amber") return "bg-amber-300";
  if (tone === "rose") return "bg-rose-300";
  if (tone === "violet") return "bg-violet-300";
  return "bg-cyan-300";
}

function legendTone(tone: "cyan" | "emerald" | "violet" | "amber") {
  if (tone === "emerald") return "bg-emerald-300";
  if (tone === "violet") return "bg-violet-300";
  if (tone === "amber") return "bg-amber-300";
  return "bg-cyan-300";
}

function formatInterval(interval: AtlasProbabilityInterval) {
  return `${interval.low}–${interval.high}%`;
}

function formatDateInterval(interval: { low: string | null; p50: string | null; high: string | null }) {
  if (!interval.p50) return "Unknown";
  return `${interval.low} → ${interval.high}`;
}

function formatHorizon(horizon: string) {
  return horizon.replace("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}
