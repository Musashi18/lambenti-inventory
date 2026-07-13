"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { AtlasMissionControlView } from "@/modules/atlas/presentation";

type AtlasProgressMapProps = {
  atlas: AtlasMissionControlView;
};

type AtlasProgressNode = AtlasMissionControlView["graph"]["nodes"][number];
type AtlasProgressDependency = AtlasMissionControlView["graph"]["dependencies"][number];
type AtlasLens = "all" | "phase1" | "risk" | "done" | "confidence" | "next";
type AtlasProjection = "roadmap" | "dependency" | "kanban" | "timeline" | "executive" | "risk" | "manufacturing" | "launch" | "daily";

type StrategicHealth = "very-healthy" | "growing" | "needs-attention" | "high-concern" | "critical";
type AtlasAiAction = "explain" | "predict-delays" | "next-action" | "bottlenecks" | "execution-plan" | "launch-impact";

type AtlasAiInsight = {
  title: string;
  summary: string;
  bullets: string[];
  confidencePct: number;
  actionHref?: string;
  actionLabel?: string;
  riskLabel: string;
};

type CommandTarget = {
  id: string;
  label: string;
  detail: string;
  kind: "node" | "projection" | "workflow" | "memory" | "document" | "supplier" | "research" | "customer" | "roadmap";
  nodeId?: string;
  projectionId?: AtlasProjection;
};

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

const PROJECTIONS: Array<{ id: AtlasProjection; label: string; lens: AtlasLens; description: string }> = [
  { id: "roadmap", label: "Roadmap View", lens: "all", description: "Every launch dependency in one company graph" },
  { id: "dependency", label: "Dependency Graph", lens: "next", description: "Selected node, prerequisites, and downstream unlocks" },
  { id: "kanban", label: "Kanban", lens: "risk", description: "Work to clear, grouped by urgency" },
  { id: "timeline", label: "Timeline", lens: "phase1", description: "Phase I path and predicted completion pressure" },
  { id: "executive", label: "Executive Dashboard", lens: "next", description: "Highest-leverage executive decision surface" },
  { id: "risk", label: "Risk Map", lens: "risk", description: "Residual risk and blocker heatmap" },
  { id: "manufacturing", label: "Manufacturing View", lens: "phase1", description: "Supplier, QA, inventory, and production readiness" },
  { id: "launch", label: "Launch Readiness View", lens: "phase1", description: "What blocks the first 25-unit launch" },
  { id: "daily", label: "Founder Daily View", lens: "next", description: "Only the strategic battlefield for today" }
];

const AI_ACTIONS: Array<{ id: AtlasAiAction; label: string }> = [
  { id: "explain", label: "Explain Why This Matters" },
  { id: "predict-delays", label: "Predict Delays" },
  { id: "next-action", label: "Suggest Next Action" },
  { id: "bottlenecks", label: "Find Bottlenecks" },
  { id: "execution-plan", label: "Generate Execution Plan" },
  { id: "launch-impact", label: "Estimate Launch Impact" }
];

const HORIZONS: AtlasProgressNode["horizon"][] = ["PHASE_1", "PHASE_2", "PHASE_3", "PHASE_4"];
const MAP_WIDTH = 1380;
const MAP_HEIGHT = 2100;
const CARD_WIDTH = 210;
const CARD_HEIGHT = 126;
const HORIZON_BASE_X: Record<AtlasProgressNode["horizon"], number> = {
  PHASE_1: 40,
  PHASE_2: 580,
  PHASE_3: 865,
  PHASE_4: 1130
};

export function AtlasProgressMap({ atlas }: AtlasProgressMapProps) {
  const defaultSelectedId = atlas.highestLeverageTask?.nodeId ?? atlas.currentBottleneck?.nodeId ?? atlas.graph.nodes[0]?.id ?? "";
  const [lens, setLens] = useState<AtlasLens>("all");
  const [selectedNodeId, setSelectedNodeId] = useState(defaultSelectedId);
  const [searchTerm, setSearchTerm] = useState("");
  const [mapZoom, setMapZoom] = useState(1);
  const [selectedPathOnly, setSelectedPathOnly] = useState(false);
  const [founderFocusEnabled, setFounderFocusEnabled] = useState(false);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [activeProjection, setActiveProjection] = useState<AtlasProjection>("roadmap");
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [playbackIndex, setPlaybackIndex] = useState(Math.max(0, atlas.decisionTimeline.length - 1));
  const [activeAiAction, setActiveAiAction] = useState<AtlasAiAction>("next-action");

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((value) => !value);
      }
      if (event.key === "Escape") setCommandOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    setPlaybackIndex(Math.max(0, atlas.decisionTimeline.length - 1));
  }, [atlas.decisionTimeline.length]);

  const visibleNodes = useMemo(() => {
    const nextChainIds = new Set<string>([selectedNode?.id, ...Array.from(dependencyIds), ...Array.from(unlockIds), ...Array.from(strategicNodeIds)].filter(Boolean) as string[]);
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const lensFiltered = atlas.graph.nodes.filter((node) => {
      if (lens === "phase1") return node.horizon === "PHASE_1";
      if (lens === "risk") return node.effectiveRiskScore >= 55 || node.blockers.length > 0;
      if (lens === "done") return node.measurementStatus === "MEASURED" && (node.completionPct >= 65 || (node.completionPct >= 50 && node.effectiveRiskScore <= 35));
      if (lens === "confidence") return node.confidencePct < 60 || node.evidence.length === 0;
      if (lens === "next") return nextChainIds.has(node.id);
      return true;
    });
    const searchFiltered = normalizedSearch
      ? lensFiltered.filter((node) => matchesNodeSearch(node, normalizedSearch))
      : lensFiltered;
    if (searchFiltered.length > 0) return searchFiltered;
    return lensFiltered.length > 0 ? lensFiltered : atlas.graph.nodes;
  }, [atlas.graph.nodes, dependencyIds, lens, searchTerm, selectedNode?.id, strategicNodeIds, unlockIds]);

  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const positions = useMemo(() => positionNodes(visibleNodes), [visibleNodes]);
  const mapContentHeight = useMemo(() => {
    const bottoms = Array.from(positions.values()).map((position) => position.y + position.height);
    return Math.max(560, Math.min(MAP_HEIGHT, Math.ceil(Math.max(0, ...bottoms) + 240)));
  }, [positions]);
  const visibleDependencies = dependencyLinks.filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to));
  const areaSummaries = useMemo(() => summarizeAreas(atlas.graph.nodes), [atlas.graph.nodes]);
  const activePathIds = useMemo(
    () => new Set<string>([selectedNode?.id, ...Array.from(dependencyIds), ...Array.from(unlockIds)].filter(Boolean) as string[]),
    [dependencyIds, selectedNode?.id, unlockIds]
  );
  const hoverDependencyIds = useMemo(() => {
    const hoveredNode = hoveredNodeId ? nodeById.get(hoveredNodeId) : null;
    return new Set(hoveredNode?.dependencies ?? []);
  }, [hoveredNodeId, nodeById]);
  const hoverUnlockIds = useMemo(
    () => new Set(dependencyLinks.filter((edge) => edge.from === hoveredNodeId).map((edge) => edge.to)),
    [dependencyLinks, hoveredNodeId]
  );
  const hoverPathIds = useMemo(
    () => new Set<string>([hoveredNodeId, ...Array.from(hoverDependencyIds), ...Array.from(hoverUnlockIds)].filter(Boolean) as string[]),
    [hoverDependencyIds, hoverUnlockIds, hoveredNodeId]
  );
  const commandTargets = useMemo(() => buildCommandTargets(atlas.graph.nodes, PROJECTIONS), [atlas.graph.nodes]);
  const donePreview = useMemo(() => atlas.graph.nodes
    .filter((node) => node.measurementStatus === "MEASURED" && (node.completionPct >= 65 || (node.completionPct >= 50 && node.effectiveRiskScore <= 35)))
    .sort((left, right) => right.completionPct - left.completionPct || left.effectiveRiskScore - right.effectiveRiskScore)
    .slice(0, 3), [atlas.graph.nodes]);
  const needsPreview = useMemo(() => atlas.graph.nodes
    .filter((node) => node.effectiveRiskScore >= 55 || node.blockers.length > 0)
    .sort((left, right) => (right.effectiveRiskScore + right.blockers.length * 10 + (100 - right.completionPct)) - (left.effectiveRiskScore + left.blockers.length * 10 + (100 - left.completionPct)))
    .slice(0, 3), [atlas.graph.nodes]);
  const selectedSignal = atlas.highestLeverageTask?.nodeId === selectedNode?.id
    ? atlas.highestLeverageTask
    : atlas.currentBottleneck?.nodeId === selectedNode?.id
      ? atlas.currentBottleneck
      : atlas.largestRisk?.nodeId === selectedNode?.id
        ? atlas.largestRisk
        : null;
  const selectedSummary = selectedSignal?.summary ?? (selectedNode ? selectedNode.measurementStatus === "MEASURED" ? `${selectedNode.title} is ${selectedNode.completionPct}% evidence-measured with ${selectedNode.effectiveRiskScore}% residual risk and ${selectedNode.confidencePct}% confidence.` : `${selectedNode.title} has no current completion measurement. Its ${selectedNode.planningBaselineCompletionPct}% planning baseline is context only, not progress proof.` : "Select a node to inspect evidence, blockers, dependencies, and unlocks.");

  const lensCounts = getLensCounts(atlas.graph.nodes, selectedNode, dependencyLinks, strategicNodeIds);
  const searchedNodeCount = searchTerm.trim() ? atlas.graph.nodes.filter((node) => matchesNodeSearch(node, searchTerm.trim().toLowerCase())).length : atlas.graph.nodes.length;
  const selectedClassification = selectedNode ? explainNodeClassification(selectedNode, dependencyIds, unlockIds, selectedSignal != null) : "Select a node to see why Atlas classified it this way.";
  const selectedMoveActions = selectedNode ? getNodeMoveActions(selectedNode, dependencyIds, unlockIds, nodeById) : [];
  const selectedStrategicScore = selectedNode ? strategicScore(selectedNode, selectedSignal?.score) : 0;
  const selectedHealth = selectedNode ? strategicHealth(selectedNode, selectedStrategicScore) : "needs-attention";
  const selectedForecast = selectedNode ? forecastNodeCompletion(selectedNode, atlas.generatedAt) : null;
  const selectedMomentum = selectedNode ? momentumSignal(selectedNode) : "Velocity unknown";
  const aiInsight = selectedNode
    ? buildAtlasAiInsight(activeAiAction, selectedNode, {
        selectedSignal,
        dependencyIds,
        unlockIds,
        nodeById,
        moveActions: selectedMoveActions,
        forecast: selectedForecast,
        momentum: selectedMomentum,
        strategicScore: selectedStrategicScore,
        launchProbability: atlas.launchProbability.p50
      })
    : null;
  const playbackEntry = atlas.decisionTimeline[Math.min(playbackIndex, Math.max(0, atlas.decisionTimeline.length - 1))];

  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-cyan-300/25 bg-[radial-gradient(circle_at_18%_20%,rgba(29,162,126,0.24),transparent_28%),radial-gradient(circle_at_82%_8%,rgba(34,211,238,0.18),transparent_28%),linear-gradient(135deg,rgba(2,6,23,0.98),rgba(15,23,42,0.96)_45%,rgba(7,64,71,0.78))] shadow-2xl shadow-cyan-950/30">
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <div className="absolute inset-0 animate-pulse bg-[radial-gradient(circle_at_20%_25%,rgba(34,211,238,0.12),transparent_24%),radial-gradient(circle_at_78%_18%,rgba(52,211,153,0.1),transparent_22%),radial-gradient(circle_at_50%_85%,rgba(250,204,21,0.06),transparent_24%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.035)_1px,transparent_1px)] bg-[size:32px_32px]" />
        <div className="absolute left-1/4 top-10 h-1 w-1 rounded-full bg-cyan-200/50 shadow-[280px_120px_0_rgba(125,211,252,0.35),640px_40px_0_rgba(52,211,153,0.32),920px_220px_0_rgba(251,191,36,0.2)]" />
      </div>
      {commandOpen ? (
        <CommandPalette
          query={commandQuery}
          setQuery={setCommandQuery}
          targets={commandTargets}
          onClose={() => setCommandOpen(false)}
          onSelect={(target) => {
            if (target.kind === "node" && target.nodeId) setSelectedNodeId(target.nodeId);
            if (target.kind === "projection" && target.projectionId) {
              const projection = PROJECTIONS.find((item) => item.id === target.projectionId);
              if (projection) {
                setActiveProjection(projection.id);
                setLens(projection.lens);
              }
            }
            setCommandOpen(false);
          }}
        />
      ) : null}
      <div className="relative border-b border-white/10 p-5 lg:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-200">Atlas Progress Map</div>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">Interactive Company Nervous System</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Explore every launch dependency as an evidence-weighted system: completion, residual risk, confidence, blockers, unlocks, and the next highest-leverage move. Display data is sanitized; raw source references stay outside the browser payload.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[460px]">
            <MapMetric label="Phase I Evidence" value={`${atlas.missionCompletionPct}%`} detail="weighted measured progress" tone="cyan" />
            <MapMetric label="Risk Peak" value={`${Math.max(0, ...atlas.graph.nodes.map((node) => node.effectiveRiskScore))}%`} detail="residual risk" tone="rose" />
            <MapMetric label="Trust" value={`${atlas.evidenceCoverage.confidencePct}%`} detail="evidence confidence" tone="emerald" />
          </div>
        </div>

        <div className="mt-5 rounded-3xl border border-white/10 bg-slate-950/45 p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">Atlas Projection Navigation</div>
              <p className="mt-1 text-xs leading-5 text-slate-500">Multiple views, one evidence graph. Switch the projection; Atlas keeps the same sanitized source of truth.</p>
            </div>
            <button type="button" onClick={() => setCommandOpen(true)} onPointerDown={() => setCommandOpen(true)} className="rounded-full border border-cyan-200/40 bg-cyan-300/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100 hover:bg-cyan-300/20">
              Command Palette · Ctrl K
            </button>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-3 2xl:grid-cols-9">
            {PROJECTIONS.map((projection) => (
              <button
                key={projection.id}
                type="button"
                onClick={() => {
                  setActiveProjection(projection.id);
                  setLens(projection.lens);
                  if (projection.id === "daily") setFounderFocusEnabled(true);
                }}
                aria-pressed={activeProjection === projection.id}
                className={`rounded-2xl border p-3 text-left transition ${activeProjection === projection.id ? "border-cyan-200 bg-cyan-300/15 text-white shadow-lg shadow-cyan-950/30" : "border-white/10 bg-white/[0.035] text-slate-300 hover:border-cyan-300/40"}`}
              >
                <div className="text-xs font-semibold">{projection.label}</div>
                <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{projection.description}</div>
              </button>
            ))}
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

        <div className="mt-5 rounded-3xl border border-white/10 bg-slate-950/45 p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Search / Zoom / Path Controls</div>
              <p className="mt-1 text-xs leading-5 text-slate-500">Filter by title, area, phase, or node ID; preserve orientation with zoom and selected-path dimming.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {[0.85, 1, 1.25].map((zoom) => (
                <button
                  key={zoom}
                  type="button"
                  onClick={() => setMapZoom(zoom)}
                  aria-pressed={mapZoom === zoom}
                  className={`rounded-full border px-3 py-1.5 font-semibold ${mapZoom === zoom ? "border-cyan-200 bg-cyan-300/15 text-cyan-50" : "border-white/10 bg-white/[0.04] text-slate-300 hover:border-cyan-300/40"}`}
                >
                  {zoom === 1 ? "100%" : `${Math.round(zoom * 100)}%`}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setSelectedPathOnly((value) => !value)}
                aria-pressed={selectedPathOnly}
                className={`rounded-full border px-3 py-1.5 font-semibold ${selectedPathOnly ? "border-emerald-200 bg-emerald-300/15 text-emerald-50" : "border-white/10 bg-white/[0.04] text-slate-300 hover:border-emerald-300/40"}`}
              >
                Selected Path Only
              </button>
              <button
                type="button"
                onClick={() => setFounderFocusEnabled((value) => !value)}
                aria-pressed={founderFocusEnabled}
                className={`rounded-full border px-3 py-1.5 font-semibold ${founderFocusEnabled ? "border-amber-200 bg-amber-300/15 text-amber-50" : "border-white/10 bg-white/[0.04] text-slate-300 hover:border-amber-300/40"}`}
              >
                Founder Focus Mode
              </button>
            </div>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px]">
            <label className="block">
              <span className="sr-only">Search Atlas nodes</span>
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search nodes, areas, phase, workflow…"
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white placeholder:text-slate-500 outline-none transition focus:border-cyan-200 focus:ring-2 focus:ring-cyan-300/20"
              />
            </label>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs leading-5 text-slate-300">
              <span className="font-semibold text-cyan-100">{visibleNodes.length}</span> visible · <span className="font-semibold text-cyan-100">{searchedNodeCount}</span> search match{searchedNodeCount === 1 ? "" : "es"}
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-3xl border border-violet-300/20 bg-violet-300/10 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-violet-200">Strategic Playback</div>
              <p className="mt-1 text-xs leading-5 text-slate-400">Scrub the current Atlas decision timeline to see what changed, why confidence moved, and what the graph is reacting to.</p>
            </div>
            <div className="min-w-0 flex-1 lg:max-w-xl">
              <input
                type="range"
                min={0}
                max={Math.max(0, atlas.decisionTimeline.length - 1)}
                value={playbackIndex}
                onChange={(event) => setPlaybackIndex(Number(event.target.value))}
                className="w-full accent-cyan-300"
                aria-label="Strategic Playback timeline slider"
              />
              <div className="mt-2 flex justify-between text-[10px] uppercase tracking-[0.18em] text-slate-500">
                <span>Generated</span>
                <span>Now</span>
              </div>
            </div>
          </div>
          {playbackEntry ? (
            <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/55 p-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-semibold uppercase tracking-[0.18em] text-violet-200">{playbackEntry.label}</span>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-slate-300">{playbackEntry.confidencePct}% confidence</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-300">{playbackEntry.summary}</p>
            </div>
          ) : null}
        </div>

        <div className="mt-5 grid gap-3 xl:grid-cols-2">
          <LensPreviewPanel title="Done So Far" description="Proven areas with stronger completion or low residual risk." nodes={donePreview} onSelect={(id) => focusNode(id, "done", setSelectedNodeId, setLens)} tone="emerald" />
          <LensPreviewPanel title="Needs Development" description="Risk, blockers, low completion, or evidence gaps that can still move launch readiness." nodes={needsPreview} onSelect={(id) => focusNode(id, "risk", setSelectedNodeId, setLens)} tone="rose" />
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
          <div className="relative" style={{ width: MAP_WIDTH * mapZoom, height: mapContentHeight * mapZoom }} aria-label="Interactive Atlas progress dependency map">
            <div className="relative origin-top-left" style={{ width: MAP_WIDTH, height: mapContentHeight, transform: `scale(${mapZoom})` }}>
              <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.06)_1px,transparent_1px)] bg-[size:48px_48px]" />
              <HorizonBackplane height={mapContentHeight} />
            <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${MAP_WIDTH} ${mapContentHeight}`} role="img" aria-label="Atlas dependency lines">
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
                const selectedActive = edge.from === selectedNode?.id || edge.to === selectedNode?.id || dependencyIds.has(edge.from) || unlockIds.has(edge.to);
                const hoverActive = hoveredNodeId != null && (edge.from === hoveredNodeId || edge.to === hoveredNodeId || hoverDependencyIds.has(edge.from) || hoverUnlockIds.has(edge.to));
                const active = selectedActive || hoverActive;
                const blocked = [edge.from, edge.to].some((nodeId) => (nodeById.get(nodeId)?.blockers.length ?? 0) > 0);
                const completed = [edge.from, edge.to].every((nodeId) => (nodeById.get(nodeId)?.completionPct ?? 0) >= 70);
                const path = edgePath(from, to);
                const dimmedByPath = (selectedPathOnly && !selectedActive) || (hoveredNodeId != null && !hoverActive);
                return (
                  <g key={`${edge.from}->${edge.to}`} className={dimmedByPath ? "opacity-15" : "opacity-100"}>
                    <path
                      d={path}
                      fill="none"
                      stroke={active ? "url(#atlas-edge-active)" : completed ? "#22d3ee" : blocked ? "#f59e0b" : "url(#atlas-edge-muted)"}
                      strokeWidth={active ? 3.4 : completed ? 2 : 1.4}
                      strokeDasharray={active || completed ? "0" : blocked ? "3 7" : "6 8"}
                      markerEnd={active ? "url(#atlas-arrow-active)" : "url(#atlas-arrow-muted)"}
                      className={`${active ? "drop-shadow-[0_0_10px_rgba(34,211,238,0.45)]" : ""} ${blocked ? "animate-pulse" : ""}`}
                    />
                    {active ? (
                      <circle r="3.4" fill={blocked ? "#f59e0b" : "#67e8f9"} opacity="0.9">
                        <animateMotion dur={blocked ? "4s" : "2.8s"} repeatCount="indefinite" path={path} />
                      </circle>
                    ) : null}
                  </g>
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
              const score = strategicScore(node, strategic ? selectedSignal?.score : undefined);
              const health = strategicHealth(node, score);
              const dimmedByPath = selectedPathOnly && !activePathIds.has(node.id);
              const dimmedByHover = hoveredNodeId != null && !hoverPathIds.has(node.id);
              const dimmedByFocus = founderFocusEnabled && !activePathIds.has(node.id) && !strategic;
              const compactDone = node.completionPct >= 85 && lens !== "done" && !selected;
              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => setSelectedNodeId(node.id)}
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onMouseLeave={() => setHoveredNodeId(null)}
                  className={`group absolute rounded-[1.35rem] border text-left backdrop-blur-xl transition duration-300 ${nodeCardTone(node, { selected, dependency, unlock, strategic })} ${strategicLayerClass({ selected, strategic, compactDone })} ${heatBorderClass(health)} ${dimmedByPath ? "opacity-35 saturate-50" : ""} ${dimmedByHover ? "opacity-20 blur-[1px] saturate-50" : ""} ${dimmedByFocus ? "opacity-15 blur-[1.5px] saturate-50" : ""}`}
                  style={{ left: position.x, top: position.y, width: compactDone ? 150 : position.width + (strategic || selected ? 18 : 0), minHeight: compactDone ? 70 : position.height + (selected ? 20 : 0) }}
                  aria-pressed={selected}
                >
                  <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${heatGradientClass(health)} ${selected || strategic ? "animate-pulse" : ""}`} />
                  <div className="absolute inset-0 bg-[linear-gradient(145deg,rgba(255,255,255,0.12),transparent_36%),radial-gradient(circle_at_15%_20%,rgba(255,255,255,0.10),transparent_28%)] opacity-70" />
                  <div className="relative p-3">
                    <div className="mb-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-slate-400">
                      <span>{node.area}</span>
                      <span className="rounded-full border border-white/10 bg-slate-950/55 px-2 py-0.5 text-[10px] text-slate-300">{formatShortHorizon(node.horizon)}</span>
                    </div>
                    <div className="flex items-start justify-between gap-2">
                      <span className={`${selected || strategic ? "text-[17px]" : "text-sm"} line-clamp-2 font-semibold leading-5 text-white`}>{node.title}</span>
                      <span className={`mt-0.5 h-3 w-3 shrink-0 rounded-full ${nodePulseTone(node)}`} aria-hidden="true" />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.16em]">
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${healthBadgeClass(health)}`}>Strategic {score}</span>
                      <span className="text-slate-500">{node.status.replace("_", " ")}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-[34px_1fr] items-center gap-3">
                      <CompletionRing value={node.completionPct} tone={health} />
                      <div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-950/80 shadow-inner shadow-black/40">
                          <div className={`h-full rounded-full bg-gradient-to-r ${heatGradientClass(health)}`} style={{ width: `${clampPercent(node.completionPct)}%`, opacity: Math.max(0.42, node.confidencePct / 100) }} />
                        </div>
                        <div className="mt-1 grid grid-cols-3 gap-1 text-[10px] text-slate-300">
                          <span>{node.measurementStatus === "MEASURED" ? `${node.completionPct}% measured` : "unmeasured"}</span>
                          <span>{node.confidencePct}% trust</span>
                          <span>{node.effectiveRiskScore}% risk</span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-cyan-100">🎯 {node.horizon === "PHASE_1" ? "Launch critical" : "Roadmap"}</span>
                      {node.blockers.length > 0 ? <span className="rounded-full border border-rose-300/25 bg-rose-300/10 px-2 py-0.5 text-rose-100">⚠ {node.blockers.length} blocker</span> : null}
                      {node.measurementStatus !== "MEASURED" ? <span className="rounded-full border border-slate-400/25 bg-slate-400/10 px-2 py-0.5 text-slate-200">◌ No completion evidence</span> : null}
                      {node.confidencePct < 60 ? <span className="rounded-full border border-slate-400/25 bg-slate-400/10 px-2 py-0.5 text-slate-200">🔒 Evidence</span> : null}
                    </div>
                  </div>
                </button>
              );
            })}
            </div>
          </div>
          <div className="border-t border-white/10 bg-slate-950/50 p-5">
            <MapLegend />
          </div>
          <div className="border-t border-white/10 bg-slate-950/45 p-5">
            <div className="grid gap-4 2xl:grid-cols-[1.35fr_0.9fr_1.1fr]">
              <AtlasAiLayerCard activeAction={activeAiAction} insight={aiInsight} onActionChange={setActiveAiAction} />
              <DependencyPulseCard dependencyIds={Array.from(dependencyIds)} unlockIds={Array.from(unlockIds)} nodeById={nodeById} onSelect={setSelectedNodeId} />
              <EvidenceStreamCard selectedNode={selectedNode} />
            </div>
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

          <div className="mt-4 rounded-3xl border border-white/10 bg-white/[0.04] p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Executive Intelligence Panel</div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <RadialGauge label="Strategic Score" value={selectedStrategicScore} tone={selectedHealth} />
              <RadialGauge label="Launch Impact" value={selectedSignal ? clampPercent(selectedSignal.score) : Math.round(selectedStrategicScore * 0.72)} tone={selectedHealth} />
              <RadialGauge label="Confidence Trend" value={selectedNode?.confidencePct ?? 0} tone={selectedNode && selectedNode.confidencePct >= 70 ? "growing" : "needs-attention"} />
              <RadialGauge label="Blocker Severity" value={selectedNode ? clampPercent(selectedNode.effectiveRiskScore + selectedNode.blockers.length * 8) : 0} tone={selectedNode && selectedNode.effectiveRiskScore >= 70 ? "critical" : "high-concern"} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <InspectorMetric label="Likely Completion" value={selectedForecast?.dateLabel ?? "Unknown"} />
              <InspectorMetric label="Confidence Window" value={selectedForecast?.windowLabel ?? "—"} />
              <InspectorMetric label="Momentum" value={selectedMomentum} />
              <InspectorMetric label="Hours Left" value={selectedNode?.estimatedHoursRemaining == null ? "Unknown" : `${selectedNode.estimatedHoursRemaining}h`} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
              <IntelligenceChip label={`⚡ ${selectedMomentum}`} />
              <IntelligenceChip label={`🧠 AI Confidence ${selectedNode?.confidencePct ?? 0}%`} />
              <IntelligenceChip label={selectedNode?.horizon === "PHASE_1" ? "🎯 Launch Critical" : "📍 Roadmap"} />
              <IntelligenceChip label={selectedNode && selectedNode.blockers.length > 0 ? "⚠️ Blocked Work" : "💰 ROI Watch"} />
            </div>
          </div>

          <div className="mt-4 rounded-3xl border border-emerald-300/20 bg-emerald-300/10 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-200">Why This Node Is Here</div>
            <p className="mt-2 text-sm leading-6 text-emerald-50/90">{selectedClassification}</p>
          </div>

          <div className="mt-4 rounded-3xl border border-amber-300/20 bg-amber-300/10 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-200">What Would Move It</div>
            {selectedMoveActions.length > 0 ? (
              <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-50/90">
                {selectedMoveActions.map((action) => <li key={action}>• {action}</li>)}
              </ul>
            ) : (
              <p className="mt-2 text-sm leading-6 text-amber-50/90">Select a node to see the fastest evidence or execution move.</p>
            )}
          </div>

        </aside>
      </div>
    </section>
  );
}

function CommandPalette({ query, setQuery, targets, onSelect, onClose }: { query: string; setQuery: (value: string) => void; targets: CommandTarget[]; onSelect: (target: CommandTarget) => void; onClose: () => void }) {
  const normalizedQuery = query.trim().toLowerCase();
  const filteredTargets = normalizedQuery
    ? targets.filter((target) => [target.label, target.detail, target.kind].some((value) => value.toLowerCase().includes(normalizedQuery))).slice(0, 16)
    : targets.slice(0, 16);

  return (
    <div className="absolute inset-0 z-50 bg-slate-950/70 p-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Command Palette">
      <div className="mx-auto max-w-3xl overflow-hidden rounded-[2rem] border border-cyan-200/30 bg-slate-950/95 shadow-2xl shadow-cyan-950/50">
        <div className="border-b border-white/10 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.26em] text-cyan-200">Command Palette</div>
              <p className="mt-1 text-xs text-slate-500">Search nodes, workflows, Hermes memory, documents, suppliers, research, customers, and roadmaps.</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-slate-300 hover:border-cyan-300/40">Esc</button>
          </div>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search Atlas…"
            className="mt-4 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none focus:border-cyan-200 focus:ring-2 focus:ring-cyan-300/20"
          />
        </div>
        <div className="max-h-[460px] overflow-y-auto p-3">
          {filteredTargets.map((target) => (
            <button key={target.id} type="button" onClick={() => onSelect(target)} className="flex w-full items-start justify-between gap-4 rounded-2xl border border-transparent p-3 text-left hover:border-cyan-300/25 hover:bg-cyan-300/10">
              <span>
                <span className="block text-sm font-semibold text-white">{target.label}</span>
                <span className="mt-1 block text-xs leading-5 text-slate-400">{target.detail}</span>
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-cyan-100">{target.kind}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function CompletionRing({ value, tone }: { value: number; tone: StrategicHealth }) {
  return (
    <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-slate-950 shadow-inner shadow-black/50">
      <div className="absolute inset-0 rounded-full" style={{ background: `conic-gradient(${healthColor(tone)} ${clampPercent(value)}%, rgba(30,41,59,0.92) 0)` }} />
      <div className="absolute inset-1 rounded-full bg-slate-950" />
      <span className="relative text-[10px] font-semibold text-white">{value}</span>
    </div>
  );
}

function RadialGauge({ label, value, tone }: { label: string; value: number; tone: StrategicHealth }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-950/70 p-3">
      <div className="flex items-center gap-3">
        <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-slate-950">
          <div className="absolute inset-0 rounded-full" style={{ background: `conic-gradient(${healthColor(tone)} ${clampPercent(value)}%, rgba(30,41,59,0.92) 0)` }} />
          <div className="absolute inset-2 rounded-full bg-slate-950" />
          <span className="relative text-sm font-semibold text-white">{Math.round(value)}</span>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</div>
          <div className={`mt-1 text-xs font-semibold ${healthTextClass(tone)}`}>{healthLabel(tone)}</div>
        </div>
      </div>
    </div>
  );
}

function IntelligenceChip({ label }: { label: string }) {
  return <span className="rounded-full border border-white/10 bg-slate-950/60 px-2.5 py-1 text-slate-200">{label}</span>;
}

function AtlasAiLayerCard({ activeAction, insight, onActionChange }: { activeAction: AtlasAiAction; insight: AtlasAiInsight | null; onActionChange: (action: AtlasAiAction) => void }) {
  return (
    <div data-atlas-card="ai-layer" className="rounded-3xl border border-cyan-300/20 bg-cyan-300/10 p-4 shadow-xl shadow-cyan-950/20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">Atlas AI Layer</div>
          <p className="mt-1 text-xs leading-5 text-cyan-50/80">Read-only intelligence for the selected node. Execution still routes through human-gated workflows.</p>
        </div>
        <span className="rounded-full border border-cyan-200/25 bg-slate-950/60 px-2.5 py-1 text-[11px] font-semibold text-cyan-100">Functional</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs xl:grid-cols-3 2xl:grid-cols-2">
        {AI_ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={() => onActionChange(action.id)}
            aria-pressed={activeAction === action.id}
            className={`rounded-2xl border px-3 py-2 text-left font-semibold transition ${activeAction === action.id ? "border-cyan-200/70 bg-cyan-300/20 text-white shadow-lg shadow-cyan-950/30" : "border-white/10 bg-slate-950/55 text-cyan-50 hover:border-cyan-200/50 hover:bg-cyan-300/10"}`}
          >
            {action.label}
          </button>
        ))}
      </div>
      {insight ? (
        <div className="mt-4 rounded-3xl border border-cyan-100/20 bg-slate-950/65 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-white">{insight.title}</div>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-cyan-100">{insight.confidencePct}% confidence · {insight.riskLabel}</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-300">{insight.summary}</p>
          <ul className="mt-3 grid gap-2 text-xs leading-5 text-slate-300 md:grid-cols-2">
            {insight.bullets.map((bullet) => <li key={bullet} className="rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2">• {bullet}</li>)}
          </ul>
          {insight.actionHref ? (
            <Link href={insight.actionHref} className="mt-3 inline-flex rounded-full border border-cyan-200/40 bg-cyan-200/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-200/20">
              {insight.actionLabel ?? "Open Linked Workflow"}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DependencyPulseCard({ dependencyIds, unlockIds, nodeById, onSelect }: { dependencyIds: string[]; unlockIds: string[]; nodeById: Map<string, AtlasProgressNode>; onSelect: (id: string) => void }) {
  return (
    <div data-atlas-card="dependency-pulse" className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Dependency Pulse</div>
      <div className="mt-3 grid gap-3 text-sm">
        <NodeList title="Depends On" ids={dependencyIds} nodeById={nodeById} onSelect={onSelect} empty="No upstream dependency." />
        <NodeList title="Unlocks" ids={unlockIds} nodeById={nodeById} onSelect={onSelect} empty="No direct downstream unlock yet." />
      </div>
    </div>
  );
}

function EvidenceStreamCard({ selectedNode }: { selectedNode: AtlasProgressNode | null }) {
  const evidence = selectedNode ? [...selectedNode.blockers, ...selectedNode.evidence.filter((item) => !selectedNode.blockers.some((blocker) => blocker.id === item.id))].slice(0, 5) : [];
  return (
    <div data-atlas-card="evidence-stream" className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Evidence Stream</div>
      {evidence.length > 0 ? (
        <ul className="mt-3 space-y-3">
          {evidence.map((item) => (
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
  );
}

function HorizonBackplane({ height }: { height: number }) {
  const panelHeight = Math.max(360, height - 84);
  return (
    <div className="absolute inset-0">
      <div className="absolute left-[24px] top-14 w-[430px] rounded-[2rem] border border-cyan-300/10 bg-cyan-300/[0.035]" style={{ height: panelHeight }} />
      <div className="absolute left-[488px] top-14 w-[215px] rounded-[2rem] border border-emerald-300/10 bg-emerald-300/[0.03]" style={{ height: panelHeight }} />
      <div className="absolute left-[728px] top-14 w-[205px] rounded-[2rem] border border-violet-300/10 bg-violet-300/[0.03]" style={{ height: panelHeight }} />
      <div className="absolute left-[963px] top-14 w-[190px] rounded-[2rem] border border-amber-300/10 bg-amber-300/[0.025]" style={{ height: panelHeight }} />
    </div>
  );
}

function MapLegend() {
  return (
    <div data-atlas-card="map-legend" className="grid gap-2 rounded-3xl border border-white/10 bg-slate-950/85 p-3 shadow-2xl shadow-slate-950/50 backdrop-blur md:grid-cols-4">
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

function LensPreviewPanel({ title, description, nodes, onSelect, tone }: { title: string; description: string; nodes: AtlasProgressNode[]; onSelect: (id: string) => void; tone: "emerald" | "rose" }) {
  return (
    <div className={`rounded-3xl border p-4 ${tone === "emerald" ? "border-emerald-300/20 bg-emerald-300/10" : "border-rose-300/20 bg-rose-300/10"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={`text-xs font-semibold uppercase tracking-[0.24em] ${tone === "emerald" ? "text-emerald-200" : "text-rose-200"}`}>{title}</div>
          <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p>
        </div>
        <span className="rounded-full border border-white/10 bg-slate-950/60 px-2 py-1 text-xs font-semibold text-white">{nodes.length}</span>
      </div>
      <div className="mt-3 grid gap-2">
        {nodes.map((node) => (
          <button key={node.id} type="button" onClick={() => onSelect(node.id)} className="rounded-2xl border border-white/10 bg-slate-950/55 p-3 text-left transition hover:border-cyan-300/40 hover:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <span className="text-sm font-semibold text-white">{node.title}</span>
              <span className="text-xs font-semibold text-cyan-100">{node.completionPct}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-900">
              <div className={`h-full rounded-full ${tone === "emerald" ? "bg-emerald-300" : "bg-rose-300"}`} style={{ width: `${clampPercent(tone === "emerald" ? node.completionPct : node.effectiveRiskScore)}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-[11px] text-slate-500">
              <span>{node.area}</span>
              <span>{node.effectiveRiskScore}% risk · {node.confidencePct}% trust</span>
            </div>
          </button>
        ))}
      </div>
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
      const x = HORIZON_BASE_X[group.horizon] + track * 255 + (useTwoTracks ? 0 : 32);
      const y = 82 + row * (useTwoTracks ? 245 : 225);
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

function matchesNodeSearch(node: AtlasProgressNode, normalizedSearch: string) {
  return [node.title, node.area, node.id, node.horizon, node.kind, node.status]
    .some((value) => value.toLowerCase().includes(normalizedSearch));
}

function explainNodeClassification(node: AtlasProgressNode, dependencyIds: Set<string>, unlockIds: Set<string>, isStrategicSignal: boolean) {
  const reasons: string[] = [];
  if (isStrategicSignal) reasons.push("Atlas is ranking it as a current strategic signal");
  if (node.blockers.length > 0) reasons.push(`${node.blockers.length} blocker${node.blockers.length === 1 ? "" : "s"} mapped`);
  if (node.effectiveRiskScore >= 55) reasons.push(`${node.effectiveRiskScore}% residual risk`);
  if (node.completionPct >= 65) reasons.push(`${node.completionPct}% complete`);
  if (node.confidencePct < 60) reasons.push(`${node.confidencePct}% evidence confidence`);
  if (dependencyIds.has(node.id)) reasons.push("upstream dependency for the selected path");
  if (unlockIds.has(node.id)) reasons.push("downstream unlock from the selected path");
  if (reasons.length === 0) reasons.push("it remains part of the full launch graph baseline");
  return `${node.title} is visible because ${joinHumanList(reasons)}.`;
}

function getNodeMoveActions(node: AtlasProgressNode, dependencyIds: Set<string>, unlockIds: Set<string>, nodeById: Map<string, AtlasProgressNode>) {
  const actions: string[] = [];
  if (node.blockers.length > 0) actions.push(`Clear or reclassify the top blocker: ${node.blockers[0].summary}`);
  if (node.dependencies.length > 0) {
    const weakestDependency = node.dependencies
      .map((id) => nodeById.get(id))
      .filter((dependency): dependency is AtlasProgressNode => Boolean(dependency))
      .sort((left, right) => (right.effectiveRiskScore + (100 - right.completionPct)) - (left.effectiveRiskScore + (100 - left.completionPct)))[0];
    if (weakestDependency) actions.push(`Advance upstream dependency: ${weakestDependency.title}`);
  }
  if (node.confidencePct < 70) actions.push("Add stronger current evidence so confidence can rise without inventing progress");
  if (node.completionPct < 70) actions.push("Complete a linked workflow milestone that provides validated operational evidence");
  if (unlockIds.size > 0 && dependencyIds.size === 0) actions.push("Use this as a launch-path unlock; its downstream nodes are waiting on it");
  if (actions.length === 0) actions.push("Keep monitoring for stale evidence; no urgent movement lever is currently ranked");
  return actions.slice(0, 4);
}

function buildAtlasAiInsight(action: AtlasAiAction, node: AtlasProgressNode, context: {
  selectedSignal: { title: string; summary: string; score: number; confidencePct: number; href?: string } | null;
  dependencyIds: Set<string>;
  unlockIds: Set<string>;
  nodeById: Map<string, AtlasProgressNode>;
  moveActions: string[];
  forecast: ReturnType<typeof forecastNodeCompletion> | null;
  momentum: string;
  strategicScore: number;
  launchProbability: number;
}): AtlasAiInsight {
  const dependencies = Array.from(context.dependencyIds).map((id) => context.nodeById.get(id)).filter((item): item is AtlasProgressNode => Boolean(item));
  const unlocks = Array.from(context.unlockIds).map((id) => context.nodeById.get(id)).filter((item): item is AtlasProgressNode => Boolean(item));
  const weakestDependency = dependencies
    .sort((left, right) => (right.effectiveRiskScore + (100 - right.completionPct)) - (left.effectiveRiskScore + (100 - left.completionPct)))[0];
  const topBlocker = node.blockers[0];
  const confidencePct = Math.round(Math.min(96, Math.max(20, (node.confidencePct * 0.65) + (context.selectedSignal?.confidencePct ?? node.confidencePct) * 0.35)));
  const riskLabel = node.blockers.length > 0 || node.effectiveRiskScore >= 70 ? "blocked" : node.effectiveRiskScore >= 50 ? "watch" : "clear";
  const workflowHref = context.selectedSignal?.href ?? node.href;

  if (action === "explain") {
    return {
      title: `Why ${node.title} Matters`,
      summary: context.selectedSignal?.summary ?? `${node.title} sits at ${node.businessImpactScore}/100 business impact with ${node.effectiveRiskScore}% residual risk and ${node.completionPct}% completion.`,
      confidencePct,
      riskLabel,
      actionHref: workflowHref,
      actionLabel: "Open Evidence Workflow",
      bullets: uniqueBullets([
        `${node.horizon === "PHASE_1" ? "Phase I launch-critical" : "Roadmap"} node with ${node.businessImpactScore}/100 business impact.`,
        `${dependencies.length} upstream dependenc${dependencies.length === 1 ? "y" : "ies"}; ${unlocks.length} direct downstream unlock${unlocks.length === 1 ? "" : "s"}.`,
        topBlocker ? `Top blocker: ${topBlocker.summary}` : `No blocker evidence is currently mapped to this node.`,
        `${node.confidencePct}% trust means this should be treated as ${node.confidencePct < 60 ? "a confidence gap" : "usable operator evidence"}.`
      ])
    };
  }

  if (action === "predict-delays") {
    const delayDrivers = [
      topBlocker?.summary,
      weakestDependency ? `${weakestDependency.title} is the weakest upstream dependency (${weakestDependency.effectiveRiskScore}% risk).` : null,
      node.confidencePct < 60 ? "Low confidence widens the date window; add current evidence before trusting precision." : null,
      node.estimatedHoursRemaining == null ? "Effort is not estimated, so schedule risk remains qualitative." : `${node.estimatedHoursRemaining}h estimated remaining effort.`
    ].filter(Boolean) as string[];
    return {
      title: `Delay Forecast for ${node.title}`,
      summary: `${context.forecast?.dateLabel ?? "No precise date"} is the current likely-completion readout. ${context.forecast?.windowLabel ?? "The forecast window is intentionally wide until effort/evidence improves."}`,
      confidencePct,
      riskLabel,
      actionHref: workflowHref,
      actionLabel: "Open Delay Driver",
      bullets: uniqueBullets(delayDrivers)
    };
  }

  if (action === "next-action") {
    return {
      title: `Next Best Action for ${node.title}`,
      summary: context.moveActions[0] ?? "Atlas has no urgent move ranked; keep monitoring for stale evidence or newly blocked dependencies.",
      confidencePct,
      riskLabel,
      actionHref: workflowHref,
      actionLabel: "Open Human-Gated Workflow",
      bullets: uniqueBullets([
        ...context.moveActions,
        `${context.momentum}; do not count time as progress unless it produces validated evidence.`,
        `If this changes operational state, use the linked workflow manually; Atlas remains read-only.`
      ]).slice(0, 5)
    };
  }

  if (action === "bottlenecks") {
    return {
      title: `Bottleneck Scan for ${node.title}`,
      summary: topBlocker ? `Atlas sees the main constraint as: ${topBlocker.summary}` : weakestDependency ? `No direct blocker is mapped; the weakest upstream node is ${weakestDependency.title}.` : "No direct blocker or upstream dependency is dominating this node.",
      confidencePct,
      riskLabel,
      actionHref: workflowHref,
      actionLabel: "Open Bottleneck Workflow",
      bullets: uniqueBullets([
        topBlocker ? `Direct blocker: ${topBlocker.summary}` : `Direct blocker: none mapped.`,
        weakestDependency ? `Upstream bottleneck: ${weakestDependency.title} (${weakestDependency.completionPct}% done, ${weakestDependency.effectiveRiskScore}% risk).` : `Upstream bottleneck: none mapped.`,
        unlocks.length > 0 ? `Clearing this can unlock ${joinHumanList(unlocks.slice(0, 3).map((item) => item.title))}.` : `No direct unlock is currently mapped downstream.`,
        `${node.blockers.length} blocker evidence item${node.blockers.length === 1 ? "" : "s"} and ${node.evidence.length} total sanitized evidence item${node.evidence.length === 1 ? "" : "s"}.`
      ])
    };
  }

  if (action === "execution-plan") {
    return {
      title: `Execution Plan for ${node.title}`,
      summary: "A safe read-only plan: clear the highest blocker, advance the weakest dependency, then attach/produce evidence so Atlas can move the graph without inventing progress.",
      confidencePct,
      riskLabel,
      actionHref: workflowHref,
      actionLabel: "Open Plan Workflow",
      bullets: uniqueBullets([
        `1. ${context.moveActions[0] ?? "Confirm the node's current evidence state."}`,
        `2. ${weakestDependency ? `Resolve or de-risk upstream dependency: ${weakestDependency.title}.` : "Update the linked workflow with current operational evidence."}`,
        `3. Produce a verifiable artifact or source update; time spent alone must not increase completion.`,
        `4. Re-open Atlas and check completion, residual risk, and confidence changed in the expected direction.`
      ])
    };
  }

  const launchImpact = node.horizon === "PHASE_1"
    ? Math.max(1, Math.round((context.strategicScore + node.businessImpactScore - node.effectiveRiskScore) / 22))
    : Math.max(1, Math.round(node.businessImpactScore / 35));
  return {
    title: `Launch Impact Estimate for ${node.title}`,
    summary: `Current P50 launch probability is ${context.launchProbability}%. Moving this node should be treated as roughly ${launchImpact} point${launchImpact === 1 ? "" : "s"} of launch-readiness leverage before recalibration.`,
    confidencePct,
    riskLabel,
    actionHref: workflowHref,
    actionLabel: "Open Launch Lever",
    bullets: uniqueBullets([
      `${node.horizon === "PHASE_1" ? "Direct Phase I launch leverage" : "Indirect roadmap leverage"}.`,
      `${context.strategicScore}/100 strategic score from impact, risk, incomplete work, confidence, and blockers.`,
      `${node.effectiveRiskScore}% residual risk means launch impact is strongest if the change also lowers risk.`,
      context.selectedSignal ? `Atlas-ranked signal score: ${context.selectedSignal.score}.` : `Not currently one of the top Atlas-ranked strategic signals.`
    ])
  };
}

function uniqueBullets(items: string[]) {
  return Array.from(new Set(items.filter((item) => item.trim().length > 0)));
}

function joinHumanList(items: string[]) {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function buildCommandTargets(nodes: AtlasProgressNode[], projections: typeof PROJECTIONS): CommandTarget[] {
  const projectionTargets: CommandTarget[] = projections.map((projection) => ({
    id: `projection:${projection.id}`,
    label: projection.label,
    detail: projection.description,
    kind: "projection",
    projectionId: projection.id
  }));
  const nodeTargets: CommandTarget[] = nodes.map((node) => ({
    id: `node:${node.id}`,
    label: node.title,
    detail: `${node.area} · ${formatShortHorizon(node.horizon)} · ${node.completionPct}% complete · ${node.effectiveRiskScore}% risk`,
    kind: "node",
    nodeId: node.id
  }));
  const staticTargets: CommandTarget[] = [
    { id: "workflow:next", label: "Open Highest-Leverage Workflow", detail: "Jump to the current Atlas-recommended human workflow", kind: "workflow" },
    { id: "memory:hermes", label: "Hermes Memory", detail: "Recall relevant founder, evidence, and launch context", kind: "memory" },
    { id: "documents:atlas", label: "Documents", detail: "Search internal docs and source evidence from linked workflows", kind: "document" },
    { id: "suppliers:critical", label: "Suppliers", detail: "Find supplier dependencies affecting launch readiness", kind: "supplier" },
    { id: "research:validation", label: "Research", detail: "Search product, customer, and market evidence", kind: "research" },
    { id: "customers:validation", label: "Customers", detail: "Review customer validation signals and launch impact", kind: "customer" },
    { id: "roadmap:atlas", label: "Roadmaps", detail: "Switch between roadmap, dependency, risk, and launch-readiness projections", kind: "roadmap" }
  ];
  return [...projectionTargets.slice(0, 4), ...staticTargets, ...projectionTargets.slice(4), ...nodeTargets];
}

function strategicScore(node: AtlasProgressNode, rankedScore?: number) {
  const base = Math.round(
    node.businessImpactScore * 0.28 +
    node.effectiveRiskScore * 0.26 +
    (100 - node.completionPct) * 0.18 +
    node.confidencePct * 0.12 +
    node.blockers.length * 7 +
    (node.horizon === "PHASE_1" ? 8 : 0) +
    (node.evidence.length > 0 ? 3 : 8)
  );
  return clampPercent(Math.max(base, rankedScore ?? 0));
}

function strategicHealth(node: AtlasProgressNode, score: number): StrategicHealth {
  if (node.effectiveRiskScore >= 80 || node.blockers.length >= 2 || score >= 82) return "critical";
  if (node.effectiveRiskScore >= 65 || score >= 68) return "high-concern";
  if (node.confidencePct < 60 || score >= 52) return "needs-attention";
  if (node.completionPct >= 65 && node.effectiveRiskScore <= 40) return "very-healthy";
  return "growing";
}

function strategicLayerClass({ selected, strategic, compactDone }: { selected: boolean; strategic: boolean; compactDone: boolean }) {
  if (selected) return "z-30 shadow-[0_0_42px_rgba(34,211,238,0.45)] ring-2 ring-cyan-100/50";
  if (strategic) return "z-20 shadow-[0_0_30px_rgba(251,191,36,0.28)]";
  if (compactDone) return "scale-95 opacity-90";
  return "z-10";
}

function heatBorderClass(health: StrategicHealth) {
  if (health === "critical") return "border-red-400/70";
  if (health === "high-concern") return "border-orange-300/60";
  if (health === "needs-attention") return "border-amber-300/55";
  if (health === "very-healthy") return "border-cyan-200/55";
  return "border-emerald-300/45";
}

function heatGradientClass(health: StrategicHealth) {
  if (health === "critical") return "from-red-500 via-rose-400 to-orange-300";
  if (health === "high-concern") return "from-orange-400 via-amber-300 to-red-300";
  if (health === "needs-attention") return "from-amber-300 via-yellow-200 to-orange-300";
  if (health === "very-healthy") return "from-cyan-300 via-sky-200 to-teal-200";
  return "from-emerald-300 via-teal-200 to-cyan-200";
}

function healthBadgeClass(health: StrategicHealth) {
  if (health === "critical") return "border border-red-300/30 bg-red-300/15 text-red-100";
  if (health === "high-concern") return "border border-orange-300/30 bg-orange-300/15 text-orange-100";
  if (health === "needs-attention") return "border border-amber-300/30 bg-amber-300/15 text-amber-100";
  if (health === "very-healthy") return "border border-cyan-300/30 bg-cyan-300/15 text-cyan-100";
  return "border border-emerald-300/30 bg-emerald-300/15 text-emerald-100";
}

function healthTextClass(health: StrategicHealth) {
  if (health === "critical") return "text-red-200";
  if (health === "high-concern") return "text-orange-200";
  if (health === "needs-attention") return "text-amber-200";
  if (health === "very-healthy") return "text-cyan-200";
  return "text-emerald-200";
}

function healthLabel(health: StrategicHealth) {
  if (health === "critical") return "Critical";
  if (health === "high-concern") return "High Concern";
  if (health === "needs-attention") return "Needs Attention";
  if (health === "very-healthy") return "Very Healthy";
  return "Growing";
}

function healthColor(health: StrategicHealth) {
  if (health === "critical") return "#ef4444";
  if (health === "high-concern") return "#fb923c";
  if (health === "needs-attention") return "#f59e0b";
  if (health === "very-healthy") return "#67e8f9";
  return "#34d399";
}

function forecastNodeCompletion(node: AtlasProgressNode, generatedAt: string) {
  if (node.estimatedHoursRemaining == null) return { dateLabel: "Unknown", windowLabel: `${node.confidencePct}% confidence` };
  const baseDate = Number.isNaN(Date.parse(generatedAt)) ? new Date() : new Date(generatedAt);
  const days = Math.max(1, Math.ceil(node.estimatedHoursRemaining / 2));
  const likely = new Date(baseDate);
  likely.setDate(likely.getDate() + days);
  const spread = node.confidencePct >= 80 ? 3 : node.confidencePct >= 60 ? 7 : 14;
  return {
    dateLabel: likely.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    windowLabel: `±${spread}d · ${node.confidencePct}%`
  };
}

function momentumSignal(node: AtlasProgressNode) {
  if (node.completionPct >= 70 && node.confidencePct >= 70) return "Velocity accelerating";
  if (node.blockers.length > 0 || node.effectiveRiskScore >= 70) return "Velocity blocked";
  if (node.confidencePct < 60) return "Waiting on evidence";
  return "Momentum stable";
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
