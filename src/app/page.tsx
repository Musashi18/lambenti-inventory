import Link from "next/link";
import { StatCard } from "@/components/stat-card";
import { DashboardTable } from "@/components/dashboard-table";
import { getDashboardSummary } from "@/modules/dashboard/service";
import { requirePermission } from "@/modules/auth/permissions";
import { getItemUseGroup, type ItemUseClassificationInput } from "@/modules/inventory/item-option-groups";

export const dynamic = "force-dynamic";

type DashboardSummary = Awaited<ReturnType<typeof getDashboardSummary>>;
type DashboardGraphs = DashboardSummary["dashboardGraphs"];
type LaunchReadiness = DashboardSummary["launchReadiness"];

export default async function DashboardPage() {
  await requirePermission("item:view");
  const summary = await getDashboardSummary();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Operations Dashboard</h1>
        <p className="text-sm text-slate-600">
          Inventory, shortages, and purchasing readiness.
        </p>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-5 text-white shadow-xl shadow-slate-900/20">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
          <div>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-200">Launch control</div>
                <h2 className="mt-1 text-2xl font-semibold">Phase I Launch Readiness</h2>
              </div>
              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-cyan-100">
                {formatLaunchStatus(summary.launchReadiness.status)}
              </span>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-4">
              <LaunchMetric label="25-unit Phase I target" value={summary.launchReadiness.targetPackages.toString()} detail="first self-assembled launch batch" />
              <LaunchMetric label="Ready now" value={summary.launchReadiness.readyNow.toString()} detail={`${summary.launchReadiness.assembledPackages} assembled + ${summary.launchReadiness.buildCapacityNow} buildable`} />
              <LaunchMetric label="Remaining gap" value={summary.launchReadiness.remainingToTarget.toString()} detail="units still not covered" />
              <LaunchMetric label="Build bottleneck" value={summary.launchReadiness.bottleneckSku || "—"} detail="current package BOM limiter" />
            </div>
          </div>
          <LaunchGauge readiness={summary.launchReadiness} graphs={summary.dashboardGraphs} />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Signals</h2>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">Read-only analytics</span>
        </div>
        <div className="grid auto-rows-fr gap-4 lg:grid-cols-2">
          <GraphPanel title="Launch Target Meter" kicker="25-unit target + value mix">
            <LaunchTargetAndValueMixGraph readiness={summary.launchReadiness} graphs={summary.dashboardGraphs} />
          </GraphPanel>
          <GraphPanel title="Operations Flow" kicker="Where operator work is queued">
            <OperationsFlowGraph graphs={summary.dashboardGraphs} />
          </GraphPanel>
          <GraphPanel title="Package Bottlenecks" kicker="Buildable packages by BOM component">
            <ComponentCapacityGraph graphs={summary.dashboardGraphs} />
          </GraphPanel>
          <GraphPanel title="Stock Pressure" kicker="Lowest coverage vs reorder point">
            <StockPressureGraph graphs={summary.dashboardGraphs} />
          </GraphPanel>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Low stock items" value={summary.lowStockItems.length} />
        <StatCard label="Components on hand" value={summary.componentsOnHand} />
        <StatCard
          label="Build capacity"
          value={summary.buildCapacity.finishedBuildCapacity}
          helperText={summary.buildCapacity.finishedSku
            ? `${summary.buildCapacity.finishedSku}${summary.buildCapacity.bottleneckSku ? ` · bottleneck ${summary.buildCapacity.bottleneckSku}` : ""}`
            : "No active finished-good BOM with component requirements."}
        />
        <StatCard label="Assembled packages" value={summary.assembledPackages} helperText="Total assembled packages currently on hand from finished-build inventory." />
        <StatCard label="Upcoming Shortages" value={summary.shortages.length} />
        <StatCard label="Inventory Valuation" value={`USD $${summary.inventoryValuation.toFixed(2)}`} />
        <StatCard label="Incoming Orders" value={summary.incomingOrders.length} />
        <StatCard label="Review Actions" value={summary.humanReviewActions.length} />
        <StatCard label="Automation Findings" value={summary.openAutomationFindings.length} />
        <StatCard label="Automation Failures" value={summary.failedAutomationRuns.length} />
      </div>

      <details className="rounded-md border border-slate-200 bg-white">
        <summary className="cursor-pointer list-none border-b border-slate-200 px-4 py-3 marker:hidden">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-medium">Human Approval Queue</h2>
              <p className="text-sm text-slate-500">
                Automatic Tracking Can Draft Order/Invoice Metadata, but These Actions Keep Money, Unmatched Imports, and Stock Receiving Under Human Review.
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">Collapsed by Default · {summary.humanReviewActions.length}</span>
          </div>
        </summary>
        {summary.humanReviewActions.length === 0 ? (
          <div className="p-4 text-sm text-slate-500">No review actions right now.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {summary.humanReviewActions.map((action, index) => (
              <div key={`${action.kind}-${action.label}-${index}`} className="flex flex-col gap-2 p-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{action.kind}</div>
                  <div className="font-medium text-slate-900">{action.label}</div>
                  <div className="text-sm text-slate-600">{action.reason}</div>
                </div>
                <Link href={action.href} className="text-sm font-medium text-ink underline underline-offset-4">
                  Review
                </Link>
              </div>
            ))}
          </div>
        )}
      </details>

      <DashboardTable
        title="In-Stock Quantities"
        columns={["Type", "SKU", "Description", "On Hand", "Reserved", "Available", "Reorder", "Target"]}
        rows={summary.stockItems
          .filter((item) => item.onHand !== 0 || item.reserved !== 0 || item.available !== 0)
          .map((item) => [
            formatItemType(item),
            item.sku,
            item.description,
            item.onHand.toString(),
            item.reserved.toString(),
            item.available.toString(),
            item.reorderPoint.toString(),
            item.targetStock.toString()
          ])}
      />

      <DashboardTable
        title="Low Stock Dashboard"
        columns={["Type", "SKU", "Description", "On Hand", "Reorder Point"]}
        rows={summary.lowStockItems.map((item) => [
          formatItemType(item),
          item.sku,
          item.description,
          item.onHand.toString(),
          item.reorderPoint.toString()
        ])}
      />

      <DashboardTable
        title="Upcoming Shortages"
        columns={["Type", "SKU", "Description", "Demand", "Available", "Shortage"]}
        rows={summary.shortages.map((item) => [
          formatItemType(item),
          item.sku,
          item.description,
          item.demand.toString(),
          item.available.toString(),
          item.shortage.toString()
        ])}
      />
    </div>
  );
}

function LaunchMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/10 p-3 shadow-inner shadow-white/5">
      <div className="text-xs uppercase tracking-wide text-slate-300">{label}</div>
      <div className="mt-1 break-words text-2xl font-semibold text-white">{value}</div>
      <div className="text-xs text-slate-400">{detail}</div>
    </div>
  );
}

function LaunchGauge({ readiness, graphs }: { readiness: LaunchReadiness; graphs: DashboardGraphs }) {
  return (
    <div className="mx-auto flex h-48 w-48 items-center justify-center rounded-full border border-white/10 p-3 shadow-2xl shadow-cyan-950/40" style={{ background: `conic-gradient(#22c55e ${graphs.launchProgress.readyPercent}%, #0f172a 0)` }} aria-label="Launch readiness gauge">
      <div className="flex h-36 w-36 flex-col items-center justify-center rounded-full border border-white/10 bg-slate-950 text-center">
        <div className="text-4xl font-semibold">{graphs.launchProgress.readyPercent}%</div>
        <div className="mt-1 text-xs uppercase tracking-[0.25em] text-cyan-200">ready</div>
        <div className="mt-2 text-xs text-slate-400">{readiness.readyNow}/{readiness.targetPackages} units</div>
      </div>
    </div>
  );
}

function GraphPanel({ title, kicker, children }: { title: string; kicker: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full min-w-0 flex-col rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
      <div className="mb-4">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{kicker}</div>
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function LaunchTargetAndValueMixGraph({ readiness, graphs }: { readiness: LaunchReadiness; graphs: DashboardGraphs }) {
  return (
    <div className="flex h-full min-w-0 flex-col gap-4">
      <LaunchTargetGraph readiness={readiness} graphs={graphs} />
      <CompactValuationMixGraph graphs={graphs} />
    </div>
  );
}

function LaunchTargetGraph({ readiness, graphs }: { readiness: LaunchReadiness; graphs: DashboardGraphs }) {
  return (
    <div className="space-y-4">
      <LaunchCoverageBar graphs={graphs} />
      <div className="h-5 overflow-hidden rounded-full bg-slate-200 shadow-inner" aria-label="Ready versus remaining launch gap">
        <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400" style={{ width: `${graphs.launchProgress.readyPercent}%` }} />
      </div>
      <div className="grid grid-cols-3 gap-3 text-sm">
        <GraphNumber label="Ready" value={readiness.readyNow.toString()} />
        <GraphNumber label="Gap" value={readiness.remainingToTarget.toString()} />
        <GraphNumber label="Target" value={readiness.targetPackages.toString()} />
      </div>
      <div className="text-xs text-slate-500">Gap share: {graphs.launchProgress.gapPercent}% of Phase I target remains uncovered.</div>
    </div>
  );
}

function LaunchCoverageBar({ graphs }: { graphs: DashboardGraphs }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Phase I coverage bridge</div>
      <div className="flex h-4 overflow-hidden rounded-full bg-slate-200" aria-label="Ready and remaining launch coverage">
        {graphs.launchCoverageSegments.map((segment) => (
          <div
            key={segment.label}
            className={`h-full ${launchSegmentClass(segment.tone)}`}
            style={{ width: `${segment.percent}%` }}
            title={`${segment.label}: ${segment.units} unit(s)`}
          />
        ))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {graphs.launchCoverageSegments.map((segment) => (
          <div key={segment.label} className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
              <span className={`h-2 w-2 rounded-full ${launchSegmentClass(segment.tone)}`} />
              <span className="truncate">{segment.label}</span>
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{segment.units} unit{segment.units === 1 ? "" : "s"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function launchSegmentClass(tone: string) {
  if (tone === "emerald") return "bg-emerald-500";
  if (tone === "cyan") return "bg-cyan-500";
  return "bg-slate-300";
}

function ComponentCapacityGraph({ graphs }: { graphs: DashboardGraphs }) {
  if (graphs.componentCapacityBars.length === 0) {
    return <div className="text-sm text-slate-500">No active package BOM components to graph.</div>;
  }

  return (
    <div className="space-y-3">
      {graphs.componentCapacityBars.map((component) => (
        <div key={component.sku}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate font-medium text-slate-700" title={component.description}>{component.sku}</span>
            <span className={component.isBottleneck ? "font-semibold text-red-600" : "text-slate-500"}>{component.capacity} buildable</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-200">
            <div className={component.isBottleneck ? "h-full rounded-full bg-red-500" : "h-full rounded-full bg-cyan-500"} style={{ width: `${Math.max(component.percentOfMax, component.capacity > 0 ? 4 : 1)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function StockPressureGraph({ graphs }: { graphs: DashboardGraphs }) {
  if (graphs.stockPressureBars.length === 0) {
    return <div className="text-sm text-slate-500">No low-stock pressure right now.</div>;
  }

  return (
    <div className="space-y-3">
      {graphs.stockPressureBars.map((item) => (
        <div key={item.sku}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate font-medium text-slate-700" title={item.description}>{item.sku}</span>
            <span className="text-slate-500">{item.available}/{item.reorderPoint}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-200">
            <div className={`${stockPressureColor(item.severity)} h-full rounded-full`} style={{ width: `${Math.max(item.coveragePercent, item.available > 0 ? 4 : 1)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function OperationsFlowGraph({ graphs }: { graphs: DashboardGraphs }) {
  return (
    <div className="space-y-3">
      {graphs.operationsFlow.map((item) => (
        <Link key={item.label} href={item.href} className="block rounded-lg border border-slate-200 bg-white p-3 hover:border-cyan-300">
          <div className="mb-2 flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-slate-800">{item.label}</span>
            <span className="text-lg font-semibold text-slate-950">{item.count}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500" style={{ width: `${Math.max(item.percentOfMax, item.count > 0 ? 5 : 0)}%` }} />
          </div>
        </Link>
      ))}
    </div>
  );
}

function CompactValuationMixGraph({ graphs }: { graphs: DashboardGraphs }) {
  if (graphs.valuationMix.length === 0) {
    return (
      <div className="flex min-w-0 items-center rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-500">
        Value mix unavailable until priced inventory exists.
      </div>
    );
  }

  const visibleMix = graphs.valuationMix.slice(0, 4);
  const hiddenCount = graphs.valuationMix.length - visibleMix.length;

  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 min-w-0">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Value mix</div>
        <div className="truncate text-xs text-slate-500">Ledger-derived inventory valuation</div>
      </div>
      <div className="flex h-3 shrink-0 overflow-hidden rounded-full bg-slate-200">
        {graphs.valuationMix.map((item, index) => (
          <div key={item.category} className={index % 2 === 0 ? "bg-emerald-400" : "bg-violet-400"} style={{ width: `${Math.max(item.sharePercent, 1)}%` }} title={`${item.label}: ${item.sharePercent}%`} />
        ))}
      </div>
      <div className="mt-3 grid min-w-0 gap-2 text-xs sm:grid-cols-2">
        {visibleMix.map((item) => (
          <div key={item.category} className="min-w-0 rounded-md bg-slate-50 px-2 py-1 ring-1 ring-slate-200">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-medium text-slate-700">{item.label}</span>
              <span className="shrink-0 tabular-nums text-slate-900">{item.sharePercent}%</span>
            </div>
            <div className="truncate text-[11px] text-slate-500">USD ${item.value.toFixed(2)}</div>
          </div>
        ))}
        {hiddenCount > 0 ? <div className="text-[11px] text-slate-500">+{hiddenCount} smaller categories</div> : null}
      </div>
    </div>
  );
}

function formatItemType(item: ItemUseClassificationInput) {
  return getItemUseGroup(item).label;
}

function GraphNumber({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-center">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function stockPressureColor(severity: string) {
  if (severity === "blocked") return "bg-red-500";
  if (severity === "critical") return "bg-orange-400";
  return "bg-emerald-400";
}

function formatLaunchStatus(status: string) {
  if (status === "COVERED") return "Target covered";
  if (status === "BLOCKED") return "Blocked";
  return "In progress";
}
