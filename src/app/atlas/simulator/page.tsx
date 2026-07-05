import Link from "next/link";
import { requirePermission } from "@/modules/auth/permissions";
import { getAtlasMissionControl } from "@/modules/atlas/service";
import { listDefaultAtlasScenarios, simulateAtlasScenario } from "@/modules/atlas/scenarios";
import type { AtlasProbabilityInterval, AtlasScenarioKind, AtlasScenarioResult } from "@/modules/atlas/types";

export const dynamic = "force-dynamic";

const scenarioOptions: Array<{ kind: AtlasScenarioKind; label: string }> = [
  { kind: "FOCUS_HOURS", label: "Work 6 focused hours/day" },
  { kind: "OUTSOURCE_PCB_ASSEMBLY", label: "Outsource PCB assembly" },
  { kind: "HIRE_MANUFACTURING_HELP", label: "Hire manufacturing help" },
  { kind: "DELAY_PACKAGING", label: "Delay packaging perfection" },
  { kind: "LAUNCH_BEFORE_PERFECTION", label: "Launch before perfecting every detail" }
];

export default async function AtlasSimulatorPage({ searchParams }: { searchParams: Promise<{ scenario?: AtlasScenarioKind; hours?: string }> }) {
  await requirePermission("atlas:view");
  const params = await searchParams;
  const atlas = await getAtlasMissionControl();
  const selectedKind = scenarioOptions.some((option) => option.kind === params.scenario) ? params.scenario : undefined;
  const focusedHours = Number(params.hours ?? 6);
  const selectedScenario = selectedKind
    ? simulateAtlasScenario(atlas, { kind: selectedKind, focusedHoursPerDay: Number.isFinite(focusedHours) ? focusedHours : 6 })
    : null;
  const scenarios = selectedScenario ? [selectedScenario] : listDefaultAtlasScenarios(atlas);

  return (
    <div className="space-y-6 bg-slate-950 text-slate-100 lg:-m-6 lg:p-6">
      <header className="rounded-3xl border border-cyan-400/20 bg-slate-900 p-6 shadow-xl shadow-slate-950/40">
        <div className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-200">Project Atlas</div>
        <h1 className="mt-3 text-3xl font-semibold text-white">Predictive Simulator</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
          Explore counterfactuals without granting Atlas mutation authority. Scenarios update probability, timeline, cash risk, manufacturing risk, and burnout risk from the current mission-control baseline.
        </p>
        <Link href="/atlas" className="mt-4 inline-flex text-sm font-semibold text-cyan-200 underline underline-offset-4">Back to Mission Control</Link>
      </header>

      <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
        <h2 className="text-xl font-semibold text-white">Scenario Input</h2>
        <form className="mt-4 grid gap-4 md:grid-cols-[1fr_180px_auto] md:items-end" action="/atlas/simulator">
          <label className="grid gap-2 text-sm text-slate-300">
            Scenario
            <select name="scenario" defaultValue={selectedKind ?? ""} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white">
              <option value="">Show default scenario set</option>
              {scenarioOptions.map((option) => <option key={option.kind} value={option.kind}>{option.label}</option>)}
            </select>
          </label>
          <label className="grid gap-2 text-sm text-slate-300">
            Focus Hours/Day
            <input name="hours" type="number" min="1" max="12" step="0.5" defaultValue={Number.isFinite(focusedHours) ? focusedHours : 6} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white" />
          </label>
          <button type="submit" className="rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/20">Simulate</button>
        </form>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        {scenarios.map((scenario) => <ScenarioCard key={scenario.title} scenario={scenario} />)}
      </section>
    </div>
  );
}

function ScenarioCard({ scenario }: { scenario: AtlasScenarioResult }) {
  return (
    <article className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl shadow-slate-950/40">
      <div className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300/80">What If</div>
      <h2 className="mt-1 text-2xl font-semibold text-white">{scenario.title}</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Metric label="Timeline Delta" value={`${scenario.timelineDeltaDays > 0 ? "+" : ""}${scenario.timelineDeltaDays} days`} />
        <Metric label="Launch Probability" value={formatInterval(scenario.launchProbability)} />
        <Metric label="Manufacturing Delay Risk" value={formatInterval(scenario.manufacturingDelayRisk)} />
        <Metric label="Cash Shortage Risk" value={formatInterval(scenario.cashShortageRisk)} />
        <Metric label="Burnout Risk" value={formatInterval(scenario.burnoutRisk)} />
        <Metric label="Value Creation" value={scenario.estimatedCompanyValueCreation} />
      </div>
      <div className="mt-5 rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Assumptions</div>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
          {scenario.assumptions.map((assumption) => <li key={assumption}>• {assumption}</li>)}
        </ul>
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold capitalize text-white">{value}</div>
    </div>
  );
}

function formatInterval(interval: AtlasProbabilityInterval) {
  return `${interval.low}–${interval.high}%`;
}
