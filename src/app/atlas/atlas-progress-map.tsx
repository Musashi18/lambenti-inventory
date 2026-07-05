"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { AtlasMissionControlView } from "@/modules/atlas/presentation";

type AtlasProgressMapProps = {
  atlas: AtlasMissionControlView;
};

type AtlasProgressNode = AtlasMissionControlView["graph"]["nodes"][number];
type AtlasProgressDependency = AtlasMissionControlView["graph"]["dependencies"][number];
type AtlasLens = "all" | "phase1" | "risk" | "done" | "confidence" | "next";

type NodePosition = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const LENSES: Array<{ id: AtlasLens; label: string; description: string }> = [
  { id: "all", label: "Everything", description: "Every mapped development area" },
  { id: "phase1", label: "Launch Path", description: "Only Phase I launch-critical work" },
  { id: "risk", label: "Needs Development", description: "High risk, blockers, and gaps" },
  { id: "done", label: "Done So Far", description: "Strongest completed/proven areas" },
  { id: "confidence", label: "Trust Gaps", description: "Low-confidence or missing evidence" },
  { id: "next", label: "Next Move", description: "Selected node plus unlock chain" }
];

const HORIZONS: AtlasProgressNode["horizon"][] = ["PHASE_1", "PHASE_2", "PHASE_3", "PHASE_4"];
const MAP_WIDTH = 1180;
const MAP_HEIGHT = 1000;
const CARD_WIDTH = 180;
const CARD_HEIGHT = 106;
const HORIZON_BASE_X: Record<AtlasProgressNode["horizon"], number> = {
  PHASE_1: 40,
  PHASE_2: 505,
  PHASE_3: 745,
  PHASE_4: 980
};

export function AtlasProgressMap({ atlas }: AtlasProgressMapProps) {
  const defaultSelectedId = atlas.highestLeverageTask?.nodeId ?? atlas.currentBottleneck?.nodeId ?? atlas.graph.nodes[0]?.id ?? "";
  const [lens, setLens] = useState<AtlasLens>("all");
  const [selectedNodeId, setSelectedNodeId] = useState(defaultSelectedId);

  const nodeById = useMemo(() => new Map(atlas.graph.nodes.map((node) => [node.id, node])), [atlas.graph.nodes]);
  const selectedNode = nodeById.get(selectedNodeId) ?? atlas.graph.nodes[0] ?? null;
  const dependencyLinks = atlas.graph.dependencies;
  const dependencyIds = useMemo(() => new Set(selectedNode?.dependencies ?? []), [selectedNode]);
  const unlockIds = useMemo(
    () => new Set(dependencyLinks.filter((edge) => edge.from === selectedNode?.id).map((edge) => edge.to)),
    [dependencyLinks, selectedNode]
  );
  const strategicNodeIds = useMemo(
    () => new Set([atlas.highestLeverageTask?.nodeId, atlas.currentBottleneck?.nodeId, atlas.largestRisk?.nodeId].filter(Boolean) as string[]),
    [atlas.currentBottleneck?.nodeId, atlas.highestLeverageTask?.nodeId, atlas.largestRisk?.nodeId]
  );

  const visibleNodes = useMemo(() => {
    const nextChainIds = new Set<string>([selectedNode?.id, ...Array.from(dependencyIds), ...Array.from(unlockIds), ...Array.from(strategicNodeIds)].filter(Boolean) as string[]);
    const filtered = atlas.graph.nodes.filter((node) => {
      if (lens === "phase1") return node.horizon === "PHASE_1";
      if (lens === "risk") return node.effectiveRiskScore >= 55 || node.blockers.length > 0;
      if (lens === "done") return node.completionPct >= 65 || (node.completionPct >= 50 && node.effectiveRiskScore <= 35);
      if (lens === "confidence") return node.confidencePct < 60 || node.evidence.length === 0;
      if (lens === "next") return nextChainIds.has(node.id);
      return true;
    });
    return filtered.length > 0 ? filtered : atlas.graph.nodes;
  }, [atlas.graph.nodes, dependencyIds, lens, selectedNode?.id, strategicNodeIds, unlockIds]);

  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const positions = useMemo(() => positionNodes(visibleNodes), [visibleNodes]);
  const visibleDependencies = dependencyLinks.filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to));
  const areaSummaries = useMemo(() => summarizeAreas(atlas.graph.nodes), [atlas.graph.nodes]);
  const selectedSignal = atlas.highestLeverageTask?.nodeId === selectedNode?.id
    ? atlas.highestLeverageTask
    : atlas.currentBottleneck?.nodeId === selectedNode?.id
      ? atlas.currentBottleneck
      : atlas.largestRisk?.nodeId === selectedNode?.id
        ? atlas.largestRisk
        : null;
  const selectedSummary = selectedSignal?.summary ?? (selectedNode ? `${selectedNode.title} is ${selectedNode.completionPct}% complete with ${selectedNode.effectiveRiskScore}% residual risk and ${selectedNode.confidencePct}% confidence.` : "Select a node to inspect evidence, blockers, dependencies, and unlocks.");

  const lensCounts = getLensCounts(atlas.graph.nodes, selectedNode, dependencyLinks, strategicNodeIds);

  return (
    <section className="overflow-hidden rounded-[2rem] border border-cyan-300/25 bg-[radial-gradient(circle_at_18%_20%,rgba(29,162,126,0.24),transparent_28%),radial-gradient(circle_at_82%_8%,rgba(34,211,238,0.18),transparent_28%),linear-gradient(135deg,rgba(2,6,23,0.98),rgba(15,23,42,0.96)_45%,rgba(7,64,71,0.78))] shadow-2xl shadow-cyan-950/30">
      <div className="border-b border-white/10 p-5 lg:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-200">Atlas Progress Map</div>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">Interactive Company Nervous System</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Explore every launch dependency as an evidence-weighted system: completion, residual risk, confidence, blockers, unlocks, and the next highest-leverage move. Display data is sanitized; raw source references stay outside the browser payload.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[460px]">
            <MapMetric label="Mission" value={`${atlas.missionCompletionPct}%`} detail="weighted complete" tone="cyan" />
            <MapMetric label="Risk Peak" value={`${Math.max(0, ...atlas.graph.nodes.map((node) => node.effectiveRiskScore))}%`} detail="residual risk" tone="rose" />
            <MapMetric label="Trust" value={`${atlas.evidenceCoverage.confidencePct}%`} detail="evidence confidence" tone="emerald" />
          </div>
        </div>

        <div className="mt-5 text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Phase Lens</div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          {LENSES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setLens(item.id)}
              className={`rounded-2xl border p-3 text-left transition duration-200 ${lens === item.id ? "border-cyan-200 bg-cyan-300/15 shadow-lg shadow-cyan-950/40" : "border-white/10 bg-white/[0.04] hover:border-cyan-300/40 hover:bg-white/[0.07]"}`}
              aria-pressed={lens === item.id}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-white">{item.label}</span>
                <span className="rounded-full border border-white/10 bg-slate-950/60 px-2 py-0.5 text-xs font-semibold text-cyan-100">{lensCounts[item.id]}</span>
              </div>
              <div className="mt-1 text-xs leading-5 text-slate-400">{item.description}</div>
            </button>
          ))}
        </div>

        <div className="mt-5 grid gap-3 xl:grid-cols-[1fr_1.2fr]">
          <div className="rounded-3xl border border-cyan-300/20 bg-slate-950/45 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">Mission Focus Strip</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <FocusButton label="Highest Leverage" detail={atlas.highestLeverageTask?.title ?? "Collect Evidence"} onClick={() => focusNode(atlas.highestLeverageTask?.nodeId ?? defaultSelectedId, "next", setSelectedNodeId, setLens)} />
              <FocusButton label="Current Bottleneck" detail={atlas.currentBottleneck?.title ?? "No Bottleneck"} onClick={() => focusNode(atlas.currentBottleneck?.nodeId ?? defaultSelectedId, "next", setSelectedNodeId, setLens)} />
              <FocusButton label="Largest Risk" detail={atlas.largestRisk?.title ?? "No Risk Ranked"} onClick={() => focusNode(atlas.largestRisk?.nodeId ?? defaultSelectedId, "risk", setSelectedNodeId, setLens)} />
            </div>
          </div>
          <div className="rounded-3xl border border-emerald-300/20 bg-slate-950/45 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200">Development Area Summary</div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">done / risk / trust</div>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {areaSummaries.slice(0, 6).map((area) => (
                <button key={area.area} type="button" onClick={() => focusNode(area.topNodeId, "all", setSelectedNodeId, setLens)} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-left hover:border-emerald-300/40 hover:bg-emerald-300/10">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-semibold text-white">{area.area}</span>
                    <span className={area.riskPct >= 65 ? "text-rose-200" : area.progressPct >= 65 ? "text-emerald-200" : "text-cyan-200"}>{area.progressPct}%</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-900">
                    <div className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-emerald-300" style={{ width: `${clampPercent(area.progressPct)}%` }} />
                  </div>
                  <div className="mt-2 flex justify-between text-[11px] text-slate-400">
                    <span>{area.nodeCount} node{area.nodeCount === 1 ? "" : "s"}</span>
                    <span>{area.riskPct}% risk · {area.confidencePct}% trust</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="overflow-x-auto border-b border-white/10 xl:border-b-0 xl:border-r">
          <div className="relative min-h-[1000px] min-w-[1180px]" aria-label="Interactive Atlas progress dependency map">
            <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.06)_1px,transparent_1px)] bg-[size:48px_48px]" />
            <HorizonBackplane />
            <svg className="absolute inset-0 h-[1000px] w-[1180px]" viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} role="img" aria-label="Atlas dependency lines">
              <defs>
                <linearGradient id="atlas-edge-active" x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.9" />
                  <stop offset="100%" stopColor="#34d399" stopOpacity="0.9" />
                </linearGradient>
                <linearGradient id="atlas-edge-muted" x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0%" stopColor="#64748b" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#94a3b8" stopOpacity="0.18" />
                </linearGradient>
                <marker id="atlas-arrow-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#34d399" opacity="0.92" />
                </marker>
                <marker id="atlas-arrow-muted" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" opacity="0.5" />
                </marker>
              </defs>
              {visibleDependencies.map((edge) => {
                const from = positions.get(edge.from);
                const to = positions.get(edge.to);
                if (!from || !to) return null;
                const active = edge.from === selectedNode?.id || edge.to === selectedNode?.id || dependencyIds.has(edge.from) || unlockIds.has(edge.to);
                const path = edgePath(from, to);
                return (
                  <path
                    key={`${edge.from}->${edge.to}`}
                    d={path}
                    fill="none"
                    stroke={active ? "url(#atlas-edge-active)" : "url(#atlas-edge-muted)"}
                    strokeWidth={active ? 3 : 1.4}
                    strokeDasharray={active ? "0" : "6 8"}
                    markerEnd={active ? "url(#atlas-arrow-active)" : "url(#atlas-arrow-muted)"}
                    className={active ? "drop-shadow-[0_0_10px_rgba(34,211,238,0.45)]" : ""}
                  />
                );
              })}
            </svg>

            {HORIZONS.map((horizon) => (
              <div key={horizon} className="absolute top-5 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200/70" style={{ left: HORIZON_BASE_X[horizon] + 10 }}>
                {formatHorizonLabel(horizon)}
              </div>
            ))}

            {visibleNodes.map((node) => {
              const position = positions.get(node.id);
              if (!position) return null;
              const selected = node.id === selectedNode?.id;
              const dependency = dependencyIds.has(node.id);
              const unlock = unlockIds.has(node.id);
              const strategic = strategicNodeIds.has(node.id);
              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => setSelectedNodeId(node.id)}
                  className={`absolute rounded-2xl border p-3 text-left transition duration-200 ${nodeCardTone(node, { selected, dependency, unlock, strategic })}`}
                  style={{ left: position.x, top: position.y, width: position.width, minHeight: position.height }}
                  aria-pressed={selected}
                >
                  <div className="mb-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-slate-400">
                    <span>{node.area}</span>
                    <span>{formatShortHorizon(node.horizon)}</span>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="line-clamp-2 text-sm font-semibold leading-5 text-white">{node.title}</span>
                    <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${nodePulseTone(node)}`} aria-hidden="true" />
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-950/70">
                    <div className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-emerald-300 to-lime-200" style={{ width: `${clampPercent(node.completionPct)}%`, opacity: Math.max(0.34, node.confidencePct / 100) }} />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-300">
                    <span>{node.completionPct}% done</span>
                    <span>{node.effectiveRiskScore}% risk</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-500">
                    <span>{node.confidencePct}% trust</span>
                    <span>{node.blockers.length} blocker{node.blockers.length === 1 ? "" : "s"}</span>
                  </div>
                </button>
              );
            })}
            <MapLegend />
          </div>
        </div>

        <aside className="bg-slate-950/70 p-5 lg:p-6">
          <div className="rounded-3xl border border-cyan-300/20 bg-cyan-300/10 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">Node Inspector</div>
            <h3 className="mt-2 text-2xl font-semibold text-white">{selectedNode?.title ?? "No node selected"}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">{selectedSummary}</p>
            {selectedSignal ? <div className="mt-3 rounded-2xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs leading-5 text-amber-100">Strategic signal · score {selectedSignal.score} · {selectedSignal.confidencePct}% confidence</div> : null}
            {selectedNode?.href ? (
              <Link href={selectedNode.href} className="mt-4 inline-flex rounded-full border border-cyan-200/40 bg-cyan-200/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-200/20">
                Open Linked Workflow
              </Link>
            ) : null}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <InspectorMetric label="Completion" value={selectedNode ? `${selectedNode.completionPct}%` : "—"} />
            <InspectorMetric label="Confidence" value={selectedNode ? `${selectedNode.confidencePct}%` : "—"} />
            <InspectorMetric label="Risk" value={selectedNode ? `${selectedNode.effectiveRiskScore}%` : "—"} />
            <InspectorMetric label="Hours Left" value={selectedNode?.estimatedHoursRemaining == null ? "Unknown" : `${selectedNode.estimatedHoursRemaining}h`} />
          </div>

          <div className="mt-4 rounded-3xl border border-white/10 bg-white/[0.04] p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Dependency Pulse</div>
            <div className="mt-3 grid gap-3 text-sm">
              <NodeList title="Depends On" ids={Array.from(dependencyIds)} nodeById={nodeById} onSelect={setSelectedNodeId} empty="No upstream dependency." />
              <NodeList title="Unlocks" ids={Array.from(unlockIds)} nodeById={nodeById} onSelect={setSelectedNodeId} empty="No direct downstream unlock yet." />
            </div>
          </div>

          <div className="mt-4 rounded-3xl border border-white/10 bg-white/[0.04] p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Evidence Stream</div>
            {selectedNode && (selectedNode.evidence.length > 0 || selectedNode.blockers.length > 0) ? (
              <ul className="mt-3 space-y-3">
                {[...selectedNode.blockers, ...selectedNode.evidence.filter((item) => !selectedNode.blockers.some((blocker) => blocker.id === item.id))].slice(0, 5).map((item) => (
                  <li key={item.id} className="rounded-2xl border border-slate-700 bg-slate-950/60 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold uppercase tracking-wide text-cyan-200">{item.sourceLabel}</span>
                      <span className="rounded-full border border-white/10 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300">{item.confidencePct}%</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-300">{item.summary}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-400">No sanitized evidence has been mapped to this node yet. Treat this as a trust gap, not as proof of completion.</p>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

function HorizonBackplane() {
  return (
    <div className="absolute inset-0">
      <div className="absolute left-[24px] top-14 h-[920px] w-[430px] rounded-[2rem] border border-cyan-300/10 bg-cyan-300/[0.035]" />
      <div className="absolute left-[488px] top-14 h-[920px] w-[215px] rounded-[2rem] border border-emerald-300/10 bg-emerald-300/[0.03]" />
      <div className="absolute left-[728px] top-14 h-[920px] w-[205px] rounded-[2rem] border border-violet-300/10 bg-violet-300/[0.03]" />
      <div className="absolute left-[963px] top-14 h-[920px] w-[190px] rounded-[2rem] border border-amber-300/10 bg-amber-300/[0.025]" />
    </div>
  );
}

function MapLegend() {
  return (
    <div className="absolute bottom-5 left-5 right-5 grid gap-2 rounded-3xl border border-white/10 bg-slate-950/85 p-3 shadow-2xl shadow-slate-950/50 backdrop-blur md:grid-cols-4">
      <LegendItem dot="bg-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.8)]" label="Selected / Active Path" detail="bright line + ring" />
      <LegendItem dot="bg-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.8)]" label="Done / Strong" detail="high progress, low risk" />
      <LegendItem dot="bg-rose-300 shadow-[0_0_12px_rgba(251,113,133,0.85)]" label="Needs Development" detail="risk or blocker heavy" />
      <LegendItem dot="bg-slate-400" label="Trust Gap" detail="missing/low confidence" />
    </div>
  );
}

function LegendItem({ dot, label, detail }: { dot: string; label: string; detail: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`h-3 w-3 shrink-0 rounded-full ${dot}`} />
      <span>
        <span className="block text-xs font-semibold text-white">{label}</span>
        <span className="block text-[11px] text-slate-500">{detail}</span>
      </span>
    </div>
  );
}

function FocusButton({ label, detail, onClick }: { label: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-left hover:border-cyan-300/40 hover:bg-cyan-300/10">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">{label}</div>
      <div className="mt-1 line-clamp-2 text-xs leading-5 text-white">{detail}</div>
    </button>
  );
}

function MapMetric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "cyan" | "rose" | "emerald" }) {
  return (
    <div className={`rounded-2xl border p-4 ${metricTone(tone)}`}>
      <div className="text-xs uppercase tracking-[0.2em] text-slate-300">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
      <div className="text-xs text-slate-400">{detail}</div>
    </div>
  );
}

function InspectorMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-950/70 p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function NodeList({ title, ids, nodeById, onSelect, empty }: { title: string; ids: string[]; nodeById: Map<string, AtlasProgressNode>; onSelect: (id: string) => void; empty: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</div>
      {ids.length > 0 ? (
        <div className="mt-2 space-y-2">
          {ids.map((id) => {
            const node = nodeById.get(id);
            if (!node) return null;
            return (
              <button key={id} type="button" onClick={() => onSelect(id)} className="w-full rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-left text-xs leading-5 text-slate-200 hover:border-cyan-300/50 hover:bg-cyan-300/10">
                {node.title}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 text-xs leading-5 text-slate-500">{empty}</p>
      )}
    </div>
  );
}

function summarizeAreas(nodes: AtlasProgressNode[]) {
  const grouped = new Map<string, AtlasProgressNode[]>();
  for (const node of nodes) {
    const bucket = grouped.get(node.area) ?? [];
    bucket.push(node);
    grouped.set(node.area, bucket);
  }

  return Array.from(grouped.entries())
    .map(([area, areaNodes]) => {
      const progressPct = Math.round(areaNodes.reduce((total, node) => total + node.completionPct, 0) / Math.max(areaNodes.length, 1));
      const riskPct = Math.round(areaNodes.reduce((total, node) => total + node.effectiveRiskScore, 0) / Math.max(areaNodes.length, 1));
      const confidencePct = Math.round(areaNodes.reduce((total, node) => total + node.confidencePct, 0) / Math.max(areaNodes.length, 1));
      const topNode = [...areaNodes].sort((left, right) => (right.effectiveRiskScore + (100 - right.completionPct)) - (left.effectiveRiskScore + (100 - left.completionPct)))[0];
      return { area, nodeCount: areaNodes.length, progressPct, riskPct, confidencePct, topNodeId: topNode.id };
    })
    .sort((left, right) => (right.riskPct + (100 - right.progressPct)) - (left.riskPct + (100 - left.progressPct)) || left.area.localeCompare(right.area));
}

function focusNode(nodeId: string, targetLens: AtlasLens, setSelectedNodeId: (id: string) => void, setLens: (lens: AtlasLens) => void) {
  if (nodeId) setSelectedNodeId(nodeId);
  setLens(targetLens);
}

function positionNodes(nodes: AtlasProgressNode[]) {
  const positions = new Map<string, NodePosition>();
  const grouped = HORIZONS.map((horizon) => ({ horizon, nodes: nodes.filter((node) => node.horizon === horizon) }));

  for (const group of grouped) {
    const useTwoTracks = group.horizon === "PHASE_1" && group.nodes.length > 6;
    group.nodes.forEach((node, index) => {
      const track = useTwoTracks ? index % 2 : 0;
      const row = useTwoTracks ? Math.floor(index / 2) : index;
      const x = HORIZON_BASE_X[group.horizon] + track * 215 + (useTwoTracks ? 0 : 32);
      const y = 82 + row * (useTwoTracks ? 132 : 122);
      positions.set(node.id, { x, y, width: CARD_WIDTH, height: CARD_HEIGHT });
    });
  }

  return positions;
}

function edgePath(from: NodePosition, to: NodePosition) {
  const startX = from.x + from.width;
  const startY = from.y + from.height / 2;
  const endX = to.x;
  const endY = to.y + to.height / 2;
  const bend = Math.max(60, Math.abs(endX - startX) * 0.5);
  return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
}

function getLensCounts(nodes: AtlasProgressNode[], selectedNode: AtlasProgressNode | null, dependencies: AtlasProgressDependency[], strategicNodeIds: Set<string>): Record<AtlasLens, number> {
  const dependencyIds = new Set(selectedNode?.dependencies ?? []);
  const unlockIds = new Set(dependencies.filter((edge) => edge.from === selectedNode?.id).map((edge) => edge.to));
  const nextIds = new Set([selectedNode?.id, ...Array.from(dependencyIds), ...Array.from(unlockIds), ...Array.from(strategicNodeIds)].filter(Boolean) as string[]);
  return {
    all: nodes.length,
    phase1: nodes.filter((node) => node.horizon === "PHASE_1").length,
    risk: nodes.filter((node) => node.effectiveRiskScore >= 55 || node.blockers.length > 0).length,
    done: nodes.filter((node) => node.completionPct >= 65 || (node.completionPct >= 50 && node.effectiveRiskScore <= 35)).length,
    confidence: nodes.filter((node) => node.confidencePct < 60 || node.evidence.length === 0).length,
    next: nextIds.size
  };
}

function nodeCardTone(node: AtlasProgressNode, flags: { selected: boolean; dependency: boolean; unlock: boolean; strategic: boolean }) {
  if (flags.selected) return "border-cyan-100 bg-cyan-300/20 shadow-2xl shadow-cyan-950/50 ring-2 ring-cyan-200/60";
  if (flags.dependency) return "border-violet-300/50 bg-violet-300/10 shadow-lg shadow-violet-950/30";
  if (flags.unlock) return "border-emerald-300/50 bg-emerald-300/10 shadow-lg shadow-emerald-950/30";
  if (flags.strategic) return "border-amber-300/45 bg-amber-300/10 shadow-lg shadow-amber-950/30";
  if (node.effectiveRiskScore >= 70) return "border-rose-300/45 bg-rose-300/10 hover:border-rose-200";
  if (node.confidencePct < 45) return "border-slate-500/60 bg-slate-900/85 hover:border-cyan-300/40";
  return "border-white/10 bg-slate-900/80 hover:border-cyan-300/40 hover:bg-slate-800/90";
}

function nodePulseTone(node: AtlasProgressNode) {
  if (node.effectiveRiskScore >= 70) return "bg-rose-300 shadow-[0_0_18px_rgba(251,113,133,0.85)]";
  if (node.completionPct >= 70) return "bg-emerald-300 shadow-[0_0_18px_rgba(52,211,153,0.75)]";
  if (node.confidencePct < 45) return "bg-slate-400 shadow-[0_0_14px_rgba(148,163,184,0.55)]";
  return "bg-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.75)]";
}

function metricTone(tone: "cyan" | "rose" | "emerald") {
  if (tone === "rose") return "border-rose-300/25 bg-rose-300/10";
  if (tone === "emerald") return "border-emerald-300/25 bg-emerald-300/10";
  return "border-cyan-300/25 bg-cyan-300/10";
}

function formatHorizonLabel(horizon: AtlasProgressNode["horizon"]) {
  if (horizon === "PHASE_1") return "Phase I · Prove";
  if (horizon === "PHASE_2") return "Phase II · Sell";
  if (horizon === "PHASE_3") return "Phase III · Scale";
  return "Phase IV";
}

function formatShortHorizon(horizon: AtlasProgressNode["horizon"]) {
  if (horizon === "PHASE_1") return "P1";
  if (horizon === "PHASE_2") return "P2";
  if (horizon === "PHASE_3") return "P3";
  return "P4";
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}
