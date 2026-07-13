/*
import Link from "next/link";
import { requirePermission } from "@/modules/auth/permissions";
import { buildAtlasDailyBrief } from "@/modules/atlas/presentation";
import { getAtlasMissionControl } from "@/modules/atlas/service";

export const dynamic = "force-dynamic";

export default async function AtlasOverlayPage() {
  await requirePermission("atlas:view");
  const atlas = await getAtlasMissionControl();
  const task = atlas.highestLeverageTask;
  const brief = buildAtlasDailyBrief(atlas);
  const physical = atlas.goalPosition?.physicalTarget ?? null;

  return (
    <main className="min-h-screen bg-transparent p-3 text-slate-100">
      <section className="w-full max-w-sm rounded-3xl border border-cyan-300/30 bg-slate-950/88 p-4 shadow-2xl shadow-cyan-950/30 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-200">Atlas Overlay</div>
            <h1 className="mt-1 text-lg font-semibold text-white">Daily Evidence Ring</h1>
          </div>
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-cyan-300/30 bg-slate-900 text-xl font-semibold text-cyan-100" style={{ background: `conic-gradient(#22d3ee ${atlas.missionCompletionPct}%, rgba(15,23,42,0.9) 0)` }} aria-label="Phase I evidence progress ring">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-950 text-sm">{atlas.missionCompletionPct}%</span>
          </div>
        </div>

        <div className="mt-4 grid gap-2">
          {physical ? <OverlayMetric label="Ledger-Built Packages" value={`${physical.assembledPackages}/${physical.targetPackages}`} /> : null}
          {physical ? <OverlayMetric label="Direct Builds Now" value={physical.buildableTowardTarget.toString()} /> : null}
          <OverlayMetric label="Deep Work Today" value={atlas.momentum.dailyDeepWorkHours == null ? "Unknown" : `${atlas.momentum.dailyDeepWorkHours}h`} />
          <OverlayMetric label="Current Focus Timer" value="Not Active" />
          <OverlayMetric label="Current Velocity" value={atlas.weeklyVelocity.currentHours == null ? "Unknown" : `${atlas.weeklyVelocity.currentHours}h/wk`} />
          <OverlayMetric label="Remaining Hours This Week" value={atlas.weeklyVelocity.requiredHours == null ? "Unknown" : `${atlas.weeklyVelocity.requiredHours}h target`} />
        </div>

        <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-900/80 p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Highest-Leverage Task</div>
          <div className="mt-2 text-sm font-semibold text-white">{task?.title ?? "Not enough evidence"}</div>
          <p className="mt-1 text-xs leading-5 text-slate-300">{task?.summary ?? "Atlas needs more evidence before ranking the next task."}</p>
          {task?.href ? <Link href={task.href} className="mt-2 inline-flex text-xs font-semibold text-cyan-200 underline underline-offset-4">Open workflow</Link> : null}
        </div>

        <div className="mt-3 grid gap-2">
          <OverlayBriefCard label="Next Action" title={brief.nextAction.title} body={brief.nextAction.summary} href={brief.nextAction.href} />
          <OverlayBriefCard label="Top Risk" title={brief.topRisk.title} body={brief.topRisk.summary} href={brief.topRisk.href} />
          <OverlayBriefCard label="Velocity Caveat" title="Forecast Trust" body={brief.velocityCaveat} />
          <OverlayBriefCard label="Confidence Marker" title="Evidence Health" body={brief.confidenceMarker} />
        </div>

        <p className="mt-3 text-xs leading-5 text-slate-400">Time and planning baselines do not fill this ring. Only current measured Lambenti evidence changes Phase I progress. {brief.privacyMarker}</p>
      </section>
    </main>
  );
}

function OverlayBriefCard({ label, title, body, href }: { label: string; title: string; body: string; href?: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white">{title}</div>
      <p className="mt-1 text-xs leading-5 text-slate-300">{body}</p>
      {href ? <Link href={href} className="mt-2 inline-flex text-xs font-semibold text-cyan-200 underline underline-offset-4">Open</Link> : null}
    </div>
  );
}

function OverlayMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2">
      <span className="text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-white">{value}</span>
    </div>
  );
}
*/

import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function AtlasOverlayPage() {
  permanentRedirect("/");
}
