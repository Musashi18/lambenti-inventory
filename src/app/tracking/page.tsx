import type { ReactNode } from "react";
import { RefreshingActionForm } from "@/app/refreshing-action-form";
import { TrackingDataDisclosure } from "./tracking-data-disclosure";
import {
  archiveTrackingNumberAction,
  deleteTrackingNumberAction,
  refreshAllTrackingAction,
  refreshSingleTrackingAction,
  saveManualTrackingNumbersAction,
  updateManualItemLeadTimeAction
} from "./actions";
import { TrackingProviderHeartbeat } from "./tracking-auto-refresh";
import {
  getLeadTimeLog,
  getTrackingDashboard,
  getTrackingLinkOptions,
  type LeadTimeLog,
  type LeadTimeLogEntry,
  type LeadTimeLogItem,
  type TrackingDashboardRow,
  type TrackingLinkOption
} from "@/modules/tracking/service";

export const dynamic = "force-dynamic";

type TrackingDashboard = Awaited<ReturnType<typeof getTrackingDashboard>>;

type Tone = "neutral" | "success" | "warning" | "danger" | "blue";

export default async function TrackingPage() {
  const [dashboard, linkOptions, leadTimeLog] = await Promise.all([
    getTrackingDashboard(),
    getTrackingLinkOptions(),
    getLeadTimeLog()
  ]);

  return (
    <main className="space-y-6">
      <TrackingHero dashboard={dashboard} />
      <TrackingSummary dashboard={dashboard} />
      <TrackingVisualCommandPanel dashboard={dashboard} />
      <OpenShipments rows={dashboard.rows} />
      <TrackingAttention dashboard={dashboard} />
      <ManualTrackingDropBox linkOptions={linkOptions} hasOpenShipments={dashboard.rows.length > 0} />
      <LeadTimeLearningLog log={leadTimeLog} />
      <DeliveredTrackingHistory rows={dashboard.deliveredRows} />
      <ArchivedTrackingNumbers rows={dashboard.archivedRows} />
    </main>
  );
}

function TrackingHero({ dashboard }: { dashboard: TrackingDashboard }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-orange-600">Shipment logistics</p>
          <h1 className="mt-1 text-3xl font-semibold text-slate-900">Tracking Workbench</h1>
        </div>
        <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm lg:min-w-80">
          <div className="font-medium text-slate-900">Tracking service connection</div>
          <div className={dashboard.service.configured ? "font-medium text-emerald-700" : "font-medium text-amber-700"}>
            {dashboard.service.configured ? `${dashboard.service.provider} configured` : `${dashboard.service.provider} not configured`}
          </div>
          <div className="text-xs leading-5 text-slate-500">
            {dashboard.service.provider === "SHIP24" ? (
              <>
                Recommended provider: Ship24. Set <code>LAMBENTI_TRACKING_STATUS_AUTH_TOKEN</code> from the Ship24 dashboard. Interval: {dashboard.service.refreshIntervalMinutes} min.
              </>
            ) : (
              <>
                Set <code>LAMBENTI_TRACKING_STATUS_URL_TEMPLATE</code> for automatic carrier status updates. Interval: {dashboard.service.refreshIntervalMinutes} min.
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function TrackingSummary({ dashboard }: { dashboard: TrackingDashboard }) {
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" aria-label="Tracking summary">
      <Metric label="Open Shipments" value={dashboard.rows.length} hint="Active tracking numbers" tone="blue" />
      <Metric label="Due refresh" value={dashboard.summary.due} hint="Ready to check now" tone={dashboard.summary.due > 0 ? "warning" : "neutral"} />
      <Metric label="Failed refresh" value={dashboard.summary.failed} hint="Needs operator review" tone={dashboard.summary.failed > 0 ? "danger" : "neutral"} />
      <Metric label="Delivered" value={dashboard.summary.delivered} hint="Retained as history" tone="success" />
      <Metric label="Saved numbers" value={dashboard.summary.total} hint="All tracking evidence" />
    </section>
  );
}

function TrackingVisualCommandPanel({ dashboard }: { dashboard: TrackingDashboard }) {
  const failedRows = dashboard.rows.filter((row) => row.refreshStatus === "FAILED" || row.currentStatus === "FAILED" || row.currentStatus === "EXCEPTION");
  const unlinkedRows = dashboard.rows.filter((row) => !row.externalOrderId && !row.purchaseOrderId);
  const stageDefinitions = [
    { key: "PENDING", label: "Pending", glow: "bg-slate-300" },
    { key: "INFO_RECEIVED", label: "Info Received", glow: "bg-yellow-300" },
    { key: "IN_TRANSIT", label: "In Transit", glow: "bg-blue-300" },
    { key: "OUT_FOR_DELIVERY", label: "Out for Delivery", glow: "bg-amber-300" },
    { key: "DELIVERED", label: "Delivered", glow: "bg-emerald-300" }
  ] as const;
  const stageCounts = stageDefinitions.map((stage) => ({
    ...stage,
    count: stage.key === "DELIVERED"
      ? dashboard.deliveredRows.length
      : dashboard.rows.filter((row) => shipmentStageKey(row.currentStatus) === stage.key).length
  }));
  const pendingNoUpdateRows = dashboard.rows.filter((row) => shipmentStageKey(row.currentStatus) === "PENDING" && row.eventCount === 0);
  const laneMax = Math.max(1, ...stageCounts.map((stage) => stage.count));
  const carrierCounts = new Map<string, number>();
  for (const row of [...dashboard.rows, ...dashboard.deliveredRows]) {
    const carrier = formatCarrier(row.carrier);
    carrierCounts.set(carrier, (carrierCounts.get(carrier) ?? 0) + 1);
  }
  const topCarriers = Array.from(carrierCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const carrierMax = Math.max(1, ...topCarriers.map(([, count]) => count));
  const riskItems = [
    { label: "Fix Failed", value: failedRows.length, className: "bg-red-400", href: "#what-needs-attention" },
    { label: "Refresh Due", value: dashboard.summary.due, className: "bg-amber-300", href: "#what-needs-attention" },
    { label: "Link Evidence", value: unlinkedRows.length, className: "bg-orange-300", href: "#manual-tracking-drop-box" },
    { label: "Review Open", value: dashboard.rows.length, className: "bg-blue-300", href: "#open-shipments" }
  ];
  const riskTotal = Math.max(1, riskItems.reduce((sum, item) => sum + item.value, 0));
  return (
    <section className="grid gap-4 xl:grid-cols-[1.45fr_0.9fr]" aria-label="Tracking visual command layer">
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white shadow-xl shadow-slate-900/10">
        <div className="pointer-events-none absolute -right-12 -top-16 h-56 w-56 rounded-full border border-emerald-300/20 bg-emerald-400/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-20 left-10 h-64 w-64 rounded-full border border-orange-300/20 bg-orange-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-emerald-200">Visual Command Layer</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Live Shipment Radar</h2>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center sm:min-w-72">
            <RadarNumber label="Open" value={dashboard.rows.length} tone="text-blue-200" />
            <RadarNumber label="Due" value={dashboard.summary.due} tone="text-amber-200" />
            <RadarNumber label="Failed" value={failedRows.length} tone="text-red-200" />
          </div>
        </div>

        <div className="relative mt-6 grid gap-3 xl:grid-cols-[1.35fr_0.8fr]">
          <div className="grid gap-3 lg:grid-cols-4">
            {stageCounts.map((stage) => {
              const width = stage.count === 0 ? "0%" : `${Math.max(12, Math.round((stage.count / laneMax) * 100))}%`;
              return (
                <div key={stage.key} className="rounded-xl border border-white/10 bg-white/5 p-3 backdrop-blur">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{stage.label}</div>
                    <div className="font-mono text-sm font-semibold text-white">{stage.count}</div>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                    <div className={`h-full rounded-full ${stage.glow}`} style={{ width }} />
                  </div>
                </div>
              );
            })}
          </div>
          <PendingTrackingPanel rows={pendingNoUpdateRows} />
        </div>

        <div className="relative mt-5 rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Risk Spectrum</div>
              <div className="mt-1 text-sm text-slate-300">Ordered action list: fix provider failures, refresh due rows, link weak provenance, then review open shipments.</div>
            </div>
            <div className="text-xs text-slate-400">{riskTotal === 1 && riskItems.every((item) => item.value === 0) ? "0 active signals" : `${riskTotal} signal${riskTotal === 1 ? "" : "s"}`}</div>
          </div>
          <div className="mt-3 flex h-4 overflow-hidden rounded-full bg-white/10" aria-label="Tracking risk spectrum by ordered action">
            {riskItems.map((item) => (
              <div key={item.label} className={`${item.className} grid min-w-0 place-items-center text-[10px] font-semibold text-slate-950`} style={{ width: item.value === 0 ? "0%" : `${(item.value / riskTotal) * 100}%` }}>
                {item.value > 0 ? item.value : ""}
              </div>
            ))}
          </div>
          <ol className="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-4">
            {riskItems.map((item, index) => (
              <li key={item.label} className="rounded-lg border border-white/10 bg-white/5 p-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{index + 1}. {item.label}</div>
                <div className="mt-1 font-mono text-lg font-semibold text-white">{item.value}</div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="grid gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-orange-600">Provider Heartbeat</p>
              <h3 className="mt-1 text-lg font-semibold text-slate-900">{dashboard.service.provider}</h3>
              <p className="mt-1 text-sm text-slate-600">Refresh cadence {dashboard.service.refreshIntervalMinutes} min · {dashboard.service.configured ? "live status enabled" : "setup needed"}</p>
              <p className="mt-1 text-xs text-slate-500">Last Good Refresh: {formatDate(dashboard.service.lastCheckedAt)}</p>
            </div>
            <RefreshingActionForm action={refreshAllTrackingAction}>
              <button className="rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800" type="submit">
                Refresh
              </button>
            </RefreshingActionForm>
          </div>
          <div className="mt-4">
            <TrackingProviderHeartbeat
              enabled={dashboard.service.configured}
              intervalMinutes={dashboard.service.refreshIntervalMinutes}
              provider={dashboard.service.provider}
              initialNextRefreshAt={dashboard.service.nextRefreshAt}
              lastCheckedAt={dashboard.service.lastCheckedAt}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-orange-600">Carrier Mix</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-900">Evidence Constellation</h3>
          <div className="mt-4 space-y-3">
            {topCarriers.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-500">No Carrier Evidence Saved Yet.</div>
            ) : topCarriers.map(([carrier, count]) => (
              <div key={carrier}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">{carrier}</span>
                  <span className="font-mono text-slate-500">{count}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.max(16, Math.round((count / carrierMax) * 100))}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function PendingTrackingPanel({ rows }: { rows: TrackingDashboardRow[] }) {
  return (
    <div className="rounded-xl border border-yellow-300/50 bg-yellow-300/15 p-4 backdrop-blur" aria-label="Pending tracking numbers without provider updates">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-yellow-200">Pending</div>
          <div className="mt-1 text-sm font-medium text-white">No Carrier Updates Yet</div>
        </div>
        <div className="grid h-12 w-12 place-items-center rounded-full bg-yellow-300 text-lg font-semibold text-slate-950">{rows.length}</div>
      </div>
      <p className="mt-3 text-xs leading-5 text-yellow-50/90">Tracking Numbers stay pending until the provider returns a first readable event. This is shipment metadata only.</p>
      {rows.length > 0 ? (
        <div className="mt-3 space-y-1">
          {rows.slice(0, 3).map((row) => (
            <div key={row.id} className="truncate rounded-md bg-black/20 px-2 py-1 font-mono text-xs text-yellow-50">{row.trackingNumber}</div>
          ))}
          {rows.length > 3 ? <div className="text-xs text-yellow-50/75">+ {rows.length - 3} more pending number{rows.length - 3 === 1 ? "" : "s"}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function RadarNumber({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur">
      <div className={`font-mono text-2xl font-semibold ${tone}`}>{value}</div>
      <div className="mt-1 text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}

function TrackingAttention({ dashboard }: { dashboard: TrackingDashboard }) {
  const failedRows = dashboard.rows.filter((row) => row.refreshStatus === "FAILED" || row.currentStatus === "FAILED" || row.currentStatus === "EXCEPTION");
  const unlinkedRows = dashboard.rows.filter((row) => !row.externalOrderId && !row.purchaseOrderId);
  const needsAttention = !dashboard.service.configured || dashboard.summary.due > 0 || failedRows.length > 0 || unlinkedRows.length > 0;

  if (!needsAttention) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">What Needs Attention</h2>
        <p className="mt-1 text-sm text-slate-600">A short action queue before the detailed shipment cards. Manual Refresh Now Lives in the Provider Heartbeat Card.</p>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {!dashboard.service.configured ? (
            <AttentionCard tone="warning" title="Connect tracking provider" label="Setup needed">
              Configure Ship24 or the custom HTTP template so refreshes use live carrier status instead of evidence-only records.
            </AttentionCard>
          ) : null}
          {failedRows.length > 0 ? (
            <AttentionCard tone="danger" title={`${failedRows.length} Refresh Failure${failedRows.length === 1 ? "" : "s"}`} label="Fix First">
              <div className="space-y-2">
                <p>Retry failed rows or check whether Ship24 rejects the number/carrier combination.</p>
                <div className="space-y-2">
                  {failedRows.slice(0, 3).map((row) => (
                    <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white p-2">
                      <span className="font-mono text-xs">{row.trackingNumber}</span>
                      <RefreshSingleButton row={row} compact />
                    </div>
                  ))}
                </div>
              </div>
            </AttentionCard>
          ) : null}
          {dashboard.summary.due > 0 ? (
            <AttentionCard tone="warning" title={`${dashboard.summary.due} due refresh`} label="Ready now">
              Use the refresh button above to check non-delivered shipments. Delivered rows are retained below and are not polled.
            </AttentionCard>
          ) : null}
          {unlinkedRows.length > 0 ? (
            <AttentionCard tone="warning" title={`${unlinkedRows.length} unlinked evidence row${unlinkedRows.length === 1 ? "" : "s"}`} label="Weak provenance">
              Add future tracking numbers with a PO selected or an Alibaba order ID so lead-time learning and receiving context stay auditable.
            </AttentionCard>
          ) : null}
      </div>
    </section>
  );
}

function OpenShipments({ rows }: { rows: TrackingDashboardRow[] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-orange-600">Active tracking numbers</p>
        <h2 className="mt-1 text-lg font-semibold text-slate-900">Open Shipments</h2>
      </div>
      {rows.length === 0 ? (
        <div className="p-5 text-sm text-slate-500">No Open Shipments. Delivered tracking information is retained in history below.</div>
      ) : (
        <div className="grid gap-4 p-5">
          {rows.map((row) => <TrackingRowCard key={row.id} row={row} />)}
        </div>
      )}
    </section>
  );
}

function TrackingRowCard({ row }: { row: TrackingDashboardRow }) {
  const problematic = row.refreshStatus === "FAILED" || row.currentStatus === "FAILED" || row.currentStatus === "EXCEPTION";
  return (
    <article data-testid="tracking-row" className={`min-w-0 rounded-xl border p-4 ${problematic ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="break-all font-mono text-base font-semibold text-slate-900">{row.trackingNumber}</div>
          <div className="mt-1 break-words text-sm font-medium text-slate-800">Linked Order: {row.linkedOrderLabel}</div>
          {row.screenedShipmentCount > 1 ? (
            <div className="mt-1 text-xs text-slate-500">
              Duplicate shipment screen: showing active stream; linked shipment numbers {row.relatedTrackingNumbers.join(", ")}.
            </div>
          ) : null}
          {row.supplierName ? <div className="mt-0.5 text-xs text-slate-500">Supplier: {row.supplierName}</div> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <StatusBadge status={row.currentStatus} />
          <RefreshBadge row={row} />
        </div>
      </div>

      <ShipmentProgressRail row={row} />

      <PackageTrackingDataDetails row={row} />
    </article>
  );
}

function ShipmentProgressRail({ row }: { row: TrackingDashboardRow }) {
  const stages = [
    { key: "PENDING", label: "Pending" },
    { key: "INFO_RECEIVED", label: "Info Received" },
    { key: "IN_TRANSIT", label: "In Transit" },
    { key: "OUT_FOR_DELIVERY", label: "Out for Delivery" },
    { key: "DELIVERED", label: "Delivered" }
  ];
  const currentIndex = shipmentProgressIndex(row.currentStatus);
  const blocked = row.refreshStatus === "FAILED" || row.currentStatus === "FAILED" || row.currentStatus === "EXCEPTION";
  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3" aria-label={`Shipment Progress for ${row.trackingNumber}`}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Shipment Progress</div>
        {blocked ? <div className="text-xs font-medium text-red-700">Provider needs review before this rail can advance.</div> : null}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-5">
        {stages.map((stage, index) => {
          const active = !blocked && index <= currentIndex;
          const current = !blocked && index === currentIndex;
          return (
            <div key={stage.key} className="min-w-0">
              <div className={`h-2 rounded-full ${active ? "bg-emerald-500" : blocked && index === 0 ? "bg-red-400" : "bg-slate-200"}`} />
              <div className={`mt-1 text-[11px] leading-4 ${current ? "font-semibold text-slate-900" : "text-slate-500"}`}>{stage.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function shipmentProgressIndex(status: string) {
  if (status === "DELIVERED") return 4;
  if (status === "OUT_FOR_DELIVERY") return 3;
  if (status === "IN_TRANSIT") return 2;
  if (status === "INFO_RECEIVED") return 1;
  return 0;
}

function shipmentStageKey(status: string) {
  if (status === "DELIVERED") return "DELIVERED";
  if (status === "OUT_FOR_DELIVERY") return "OUT_FOR_DELIVERY";
  if (status === "IN_TRANSIT") return "IN_TRANSIT";
  if (status === "INFO_RECEIVED") return "INFO_RECEIVED";
  return "PENDING";
}

function ManualTrackingDropBox({ linkOptions, hasOpenShipments }: { linkOptions: TrackingLinkOption[]; hasOpenShipments: boolean }) {
  return (
    <details className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" open={!hasOpenShipments}>
      <summary className="cursor-pointer list-none">
        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Add Tracking Evidence</h2>
          </div>
          <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700">Manual Drop Box</span>
        </div>
      </summary>
      <p className="mt-4 text-sm text-slate-600">Paste a Tracking Number, Shipment Email, or Alibaba Order URL. Pick a PO When Known; Otherwise the App Auto-Matches by Alibaba Order Number.</p>
      <RefreshingActionForm action={saveManualTrackingNumbersAction} className="mt-4 space-y-4">
        <label className="block text-sm font-medium text-slate-700">
          Tracking Numbers / Shipment Email Text
          <textarea
            className="mt-1 min-h-32 w-full rounded-lg border border-dashed border-orange-300 bg-orange-50 px-3 py-3 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
            name="rawText"
            placeholder={"1Z675EW60490310023\nAlibaba order 304716450001023166 shipped\nTrack Package: 888071620741\nhttps://biz.alibaba.com/ta/detail.htm?orderId=304716450001023166"}
            required
          />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
            Link to receiving PO (preferred)
            <select name="purchaseOrderId" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900">
              <option value="">Auto-match by order number</option>
              {linkOptions.map((option) => (
                <option key={option.purchaseOrderId} value={option.purchaseOrderId}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
            Alibaba / Supplier Order Number
            <input name="externalOrderId" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900" placeholder="304716450001023166" />
          </label>
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
            Supplier Name (Optional)
            <input name="supplierName" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900" placeholder="Supplier from shipment email" />
          </label>
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
            Evidence URL (Optional)
            <input name="sourceUrl" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900" placeholder="https://biz.alibaba.com/ta/detail.htm?..." type="url" />
          </label>
        </div>
        <button className="rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700" type="submit">
          Save Tracking Numbers
        </button>
      </RefreshingActionForm>
    </details>
  );
}

function DeliveredTrackingHistory({ rows }: { rows: TrackingDashboardRow[] }) {
  return (
    <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <summary className="cursor-pointer list-none border-b border-slate-200 p-5">
        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Delivered Tracking History</h2>
          </div>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">Delivered {rows.length}</span>
        </div>
      </summary>
      <p className="border-b border-slate-100 px-5 py-3 text-sm text-slate-600">{rows.length} Delivered Record{rows.length === 1 ? "" : "s"} Retained for Evidence. Total Ship Time Is Measured from First Carrier Event to Delivery When Available.</p>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Tracking Number</th>
              <th className="px-4 py-3">Linked Order</th>
              <th className="px-4 py-3">Carrier</th>
              <th className="px-4 py-3">Delivered</th>
              <th className="px-4 py-3">Total Ship Time</th>
              <th className="px-4 py-3">Latest Event</th>
              <th className="px-4 py-3">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">No delivered tracking history yet.</td>
              </tr>
            ) : rows.map((row, rowIndex) => (
              <DeliveredTrackingRow key={row.id} row={row} rowIndex={rowIndex} />
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function DeliveredTrackingRow({ row, rowIndex }: { row: TrackingDashboardRow; rowIndex: number }) {
  const rowShade = rowIndex % 2 === 0 ? "bg-white" : "bg-slate-50";
  return (
    <>
      <tr data-testid="delivered-tracking-row" className={`align-top ${rowShade}`}>
        <td className="px-4 py-3 font-mono text-slate-900">{row.trackingNumber}</td>
        <td className="px-4 py-3">
          <div className="font-medium text-slate-900">{row.linkedOrderLabel}</div>
          {row.supplierName ? <div className="text-xs text-slate-500">{row.supplierName}</div> : null}
        </td>
        <td className="px-4 py-3 text-slate-700">{formatCarrier(row.carrier)}</td>
        <td className="px-4 py-3">
          <StatusBadge status={row.currentStatus} />
          <div className="mt-1 text-xs text-slate-500">{formatDate(row.deliveredAt ?? row.shipTimeEndedAt)}</div>
        </td>
        <td className="px-4 py-3 text-slate-700">
          <div className="font-medium text-slate-900">{row.shipTimeLabel ?? "—"}</div>
          {row.shipTimeStartedAt && row.shipTimeEndedAt ? (
            <div className="text-xs text-slate-500">{formatDate(row.shipTimeStartedAt)} → {formatDate(row.shipTimeEndedAt)}</div>
          ) : <div className="text-xs text-slate-400">Carrier event range unavailable</div>}
        </td>
        <td className="px-4 py-3 text-slate-700"><LatestEvent row={row} /></td>
        <td className="px-4 py-3 text-xs text-slate-600"><SourceCell row={row} /></td>
      </tr>
      <tr className={`border-t border-slate-100 ${rowShade}`}>
        <td colSpan={7} className="px-4 py-3">
          <PackageTrackingDataDetails row={row} compact />
        </td>
      </tr>
    </>
  );
}

function ArchivedTrackingNumbers({ rows }: { rows: TrackingDashboardRow[] }) {
  return (
    <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <summary className="cursor-pointer list-none border-b border-slate-200 p-5">
        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Inactive tracking evidence</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">Archived Tracking Numbers</h2>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">Archived {rows.length}</span>
        </div>
      </summary>
      <p className="border-b border-slate-100 px-5 py-3 text-sm text-slate-600">{rows.length} Archived Record{rows.length === 1 ? "" : "s"} Kept for provenance. Archived numbers are hidden from active refresh and do not confirm delivery or receiving.</p>
      {rows.length === 0 ? (
        <div className="p-5 text-sm text-slate-500">No archived tracking numbers yet.</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {rows.map((row, rowIndex) => (
            <div key={row.id} className={`p-5 ${rowIndex % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="font-mono text-sm font-semibold text-slate-900">{row.trackingNumber}</div>
                  <div className="mt-1 text-sm text-slate-700">{row.linkedOrderLabel}</div>
                  {row.supplierName ? <div className="text-xs text-slate-500">Supplier: {row.supplierName}</div> : null}
                  {row.statusDescription ? <div className="mt-1 text-xs text-slate-500">Archive Note: {row.statusDescription}</div> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  <StatusBadge status={row.currentStatus} />
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">Updated {formatDate(row.updatedAt)}</span>
                </div>
              </div>
              <div className="mt-3">
                <PackageTrackingDataDetails row={row} compact />
              </div>
            </div>
          ))}
        </div>
      )}
    </details>
  );
}

function LeadTimeLearningLog({ log }: { log: LeadTimeLog }) {
  return (
    <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <summary className="cursor-pointer list-none border-b border-slate-200 p-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-orange-600">Reorder Forecasting Input</p>
        <div className="mt-1 flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Advanced: Lead-Time Learning Audit</h2>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">{log.itemCount} Item{log.itemCount === 1 ? "" : "s"} · {log.sampleCount} Sample{log.sampleCount === 1 ? "" : "s"}</span>
        </div>
      </summary>
      <p className="border-b border-slate-100 px-5 py-3 text-sm text-slate-600">Every active item has a planning lead-time row. Manual entries are primary for planning; observed history remains evidence from completed purchase-to-receipt/delivery samples.</p>
      <div className="grid gap-4 border-b border-slate-100 p-5 md:grid-cols-4">
        <Metric label="Sampled items" value={log.itemCount} />
        <Metric label="Order-line samples" value={log.sampleCount} />
        <Metric label="Quantity sampled" value={log.totalQuantityOrdered} />
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Avg lead / ship</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{formatDays(log.averageLeadTimeDays)}</div>
          <div className="text-xs text-slate-500">shipping {formatDays(log.averageShipTimeDays)}</div>
        </div>
      </div>
      <div className="divide-y divide-slate-100">
        {log.items.length === 0 ? (
          <div className="p-5 text-sm text-slate-500">No active items have lead-time records yet.</div>
        ) : log.items.map((item, itemIndex) => <LeadTimeLogItemDetails key={item.itemId} item={item} itemIndex={itemIndex} />)}
      </div>
    </details>
  );
}

function LeadTimeLogItemDetails({ item, itemIndex }: { item: LeadTimeLogItem; itemIndex: number }) {
  return (
    <details className={`group p-5 ${itemIndex % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
      <summary className="flex cursor-pointer list-none flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="font-medium text-slate-900">{item.itemSku}</div>
          <div className="text-sm text-slate-600">{item.itemDescription}</div>
          <div className="mt-1 text-xs text-slate-500">
            Current Item Lead Time {item.currentLeadTimeDays} Days · {item.leadTimeLabel} · Shipping Avg {formatDays(item.averageShipTimeDays)}
          </div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${leadTimeSourceBadgeClass(item.leadTimeSource)}`}>
          {leadTimeSourceBadgeLabel(item)}
        </span>
      </summary>
      <RefreshingActionForm action={updateManualItemLeadTimeAction} className="mt-4 flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-end">
        <input type="hidden" name="itemId" value={item.itemId} />
        <label className="text-sm font-medium text-slate-700">
          Manual/planning lead time days
          <input
            name="leadTimeDays"
            type="number"
            min="0"
            step="1"
            defaultValue={item.currentLeadTimeDays}
            className="mt-1 w-36 rounded-md border border-slate-300 bg-white px-3 py-2 font-normal text-slate-900"
          />
        </label>
        <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
          Save lead time
        </button>
        <p className="text-xs text-slate-500 sm:max-w-md">
          Saving here records a manual planning estimate. It becomes the primary item lead time and also mirrors to the preferred supplier lead time; completed receiving/shipping samples stay as evidence without overriding a manual value.
        </p>
      </RefreshingActionForm>
      {item.entries.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-500">
          No purchase-to-received tracking sample yet. Manual lead time is the active planning estimate for this item.
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-100">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">Supplier</th>
                <th className="px-3 py-2">Qty</th>
                <th className="px-3 py-2">Lead Time</th>
                <th className="px-3 py-2">Start → End</th>
                <th className="px-3 py-2">Shipping</th>
                <th className="px-3 py-2">Tracking Evidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {item.entries.map((entry, entryIndex) => <LeadTimeLogEntryRow key={`${entry.purchaseOrderId}-${entry.itemId}-${entry.endAt.toISOString()}`} entry={entry} rowIndex={entryIndex} />)}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

function leadTimeSourceBadgeClass(source: LeadTimeLogItem["leadTimeSource"]) {
  if (source === "OBSERVED") return "bg-emerald-50 text-emerald-700";
  if (source === "MANUAL") return "bg-sky-50 text-sky-700";
  return "bg-slate-100 text-slate-700";
}

function leadTimeSourceBadgeLabel(item: LeadTimeLogItem) {
  if (item.leadTimeSource === "OBSERVED") return `${item.sampleCount} Sample${item.sampleCount === 1 ? "" : "s"}`;
  if (item.leadTimeSource === "MANUAL") return "Manual primary";
  return "Catalog/default";
}

function LeadTimeLogEntryRow({ entry, rowIndex }: { entry: LeadTimeLogEntry; rowIndex: number }) {
  return (
    <tr className={`align-top ${rowIndex % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
      <td className="px-3 py-2">
        <div className="font-mono text-xs text-slate-900">{entry.externalOrderId ?? entry.purchaseOrderId}</div>
        <div className="text-xs text-slate-500">PO {entry.purchaseOrderId}</div>
      </td>
      <td className="px-3 py-2 text-slate-700">{entry.supplierName}</td>
      <td className="px-3 py-2 text-slate-700">
        <div>{entry.quantityOrdered} quantity ordered</div>
        <div className="text-xs text-slate-500">{entry.quantityReceived} received</div>
      </td>
      <td className="px-3 py-2">
        <div className="font-medium text-slate-900">{entry.leadTimeLabel}</div>
        <div className="text-xs text-slate-500">Endpoint: {entry.endSource.toLowerCase()}</div>
      </td>
      <td className="px-3 py-2 text-xs text-slate-600">
        <div>{formatDate(entry.startAt)}</div>
        <div>→ {formatDate(entry.endAt)}</div>
      </td>
      <td className="px-3 py-2 text-slate-700">
        <div>{entry.shipTimeLabel ?? "—"}</div>
        {entry.shipTimeStartedAt && entry.shipTimeEndedAt ? (
          <div className="text-xs text-slate-500">{formatDate(entry.shipTimeStartedAt)} → {formatDate(entry.shipTimeEndedAt)}</div>
        ) : <div className="text-xs text-slate-400">No Carrier Range</div>}
      </td>
      <td className="px-3 py-2 font-mono text-xs text-slate-700">
        {entry.trackingNumbers.length > 0 ? entry.trackingNumbers.join(", ") : "—"}
      </td>
    </tr>
  );
}

function PackageTrackingDataDetails({ row, compact = false }: { row: TrackingDashboardRow; compact?: boolean }) {
  return (
    <TrackingDataDisclosure
      compact={compact}
      eventCount={row.eventCount}
      latestEventMarker={trackingDataReadSignature(row)}
      trackingId={row.id}
      trackingNumber={row.trackingNumber}
    >
      <EventTimeline row={row} />
      <ShipmentDetailsDisclosure row={row} />
    </TrackingDataDisclosure>
  );
}

function trackingDataReadSignature(row: TrackingDashboardRow) {
  const latestEvent = row.events[0];
  if (!latestEvent) return null;
  return [
    latestEvent.id,
    latestEvent.status ?? "",
    latestEvent.description,
    latestEvent.location ?? "",
    latestEvent.occurredAt?.toISOString() ?? "",
    latestEvent.createdAt.toISOString()
  ].join("|");
}

function ShipmentDetailsDisclosure({ row }: { row: TrackingDashboardRow }) {
  return (
    <details className="rounded-lg border border-slate-200 bg-white">
      <summary className="cursor-pointer list-none p-3 marker:hidden">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">Shipment Details</div>
            <div className="text-xs text-slate-500">Carrier, latest event, refresh schedule, source evidence, and raw provider payloads.</div>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600">Expand Details</span>
        </div>
      </summary>
      <div className="space-y-4 border-t border-slate-200 p-3">
        <div className="grid gap-3 md:grid-cols-2">
          <Fact label="Carrier" value={formatCarrier(row.carrier)} />
          <Fact label="Latest Event" value={<LatestEvent row={row} />} />
          <Fact label="Refresh" value={<RefreshSummary row={row} />} />
          <Fact label="Source" value={<SourceCell row={row} />} />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <DataPoint label="Tracking Number" value={row.trackingNumber} mono />
          <DataPoint label="Provider / Carrier" value={`${row.provider} / ${formatCarrier(row.carrier)}`} />
          <DataPoint label="Status" value={`${formatLabel(row.currentStatus)} · refresh ${formatLabel(row.refreshStatus)}`} />
          <DataPoint label="Linked Order" value={row.linkedOrderLabel} />
          <DataPoint label="Linked Shipments" value={row.relatedTrackingNumbers.length > 1 ? row.relatedTrackingNumbers.join(", ") : "—"} mono />
          <DataPoint label="External Order" value={row.externalOrderId ?? "—"} mono />
          <DataPoint label="Purchase Order" value={row.purchaseOrderId ?? "—"} mono />
          <DataPoint label="Captured Source" value={formatLabel(row.source)} />
          <DataPoint label="Last Checked" value={formatDate(row.lastCheckedAt)} />
          <DataPoint label="Next Refresh" value={formatDate(row.nextRefreshAt)} />
        </div>
        {row.statusDescription ? <p className="text-sm text-slate-600">{row.statusDescription}</p> : null}
        {row.refreshError ? <p className="rounded-md border border-red-200 bg-white px-3 py-2 text-sm text-red-700">{row.refreshError}</p> : null}
        <div className="grid gap-3 lg:grid-cols-2">
          <JsonDisclosure label="Raw Provider Status Payload" value={row.rawStatusJson} />
          <JsonDisclosure label="Raw Event Payloads" value={row.events.map((event) => ({
            status: event.status,
            description: event.description,
            location: event.location,
            occurredAt: event.occurredAt?.toISOString() ?? null,
            rawEventJson: event.rawEventJson
          }))} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-slate-500">Events saved: {row.eventCount}</div>
          <div className="flex flex-wrap items-center gap-2">
            <RefreshSingleButton row={row} />
            {row.currentStatus !== "ARCHIVED" && row.currentStatus !== "DELIVERED" ? (
              <>
                <ArchiveTrackingButton row={row} />
                <DeleteTrackingButton row={row} />
              </>
            ) : null}
          </div>
        </div>
        {row.currentStatus !== "ARCHIVED" && row.currentStatus !== "DELIVERED" ? (
          <p className="text-[11px] text-slate-500">Archive hides a stale active number; delete removes an incorrect active evidence row. Neither action receives stock or confirms delivery.</p>
        ) : null}
      </div>
    </details>
  );
}

function EventTimeline({ row }: { row: TrackingDashboardRow }) {
  if (row.events.length === 0) {
    return <div className="rounded-md border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-500">No provider events have been saved yet.</div>;
  }
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Complete event timeline</div>
      <ol className="space-y-3">
        {row.events.map((event) => (
          <li key={event.id} className="grid gap-3 rounded-md border border-slate-200 bg-white p-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <div className="text-xs text-slate-500">{formatDate(event.occurredAt ?? event.createdAt)}</div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                {event.status ? <StatusBadge status={normalizeDisplayStatus(event.status)} /> : null}
                <span className="text-sm font-medium text-slate-900">{event.description}</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">{event.location ?? "No location"}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function DataPoint({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 break-words text-sm text-slate-900 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function JsonDisclosure({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="rounded-md border border-slate-200 bg-white">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</summary>
      <pre className="max-h-72 overflow-auto border-t border-slate-100 p-3 text-xs leading-5 text-slate-700">{safeJson(value)}</pre>
    </details>
  );
}

function safeJson(value: unknown) {
  if (value === null || value === undefined) return "No provider payload saved.";
  return JSON.stringify(value, null, 2);
}

function normalizeDisplayStatus(status: string) {
  return status.toUpperCase().replace(/[\s-]+/g, "_");
}

function AttentionCard({ tone, title, label, children }: { tone: Tone; title: string; label: string; children: ReactNode }) {
  const classes = tone === "danger"
    ? "border-red-200 bg-red-50 text-red-900"
    : tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-slate-200 bg-slate-50 text-slate-900";
  const labelClass = tone === "danger" ? "text-red-700" : tone === "warning" ? "text-amber-700" : "text-slate-500";
  return (
    <div className={`rounded-lg border p-4 text-sm ${classes}`}>
      <div className={`text-xs font-semibold uppercase tracking-wide ${labelClass}`}>{label}</div>
      <div className="mt-1 font-semibold">{title}</div>
      <div className="mt-2 leading-5">{children}</div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-slate-800">{value}</div>
    </div>
  );
}

function LatestEvent({ row }: { row: TrackingDashboardRow }) {
  return row.latestEvent ? (
    <div>
      <div>{row.latestEvent.description}</div>
      <div className="text-xs text-slate-500">{row.latestEvent.location ?? "No location"} · {formatDate(row.latestEvent.occurredAt)}</div>
    </div>
  ) : <span className="text-slate-400">No events yet</span>;
}

function RefreshSummary({ row }: { row: TrackingDashboardRow }) {
  return (
    <div>
      <div className="font-medium">{formatLabel(row.refreshStatus)}</div>
      <div className="text-xs text-slate-500">Last: {formatDate(row.lastCheckedAt)}</div>
      <div className="text-xs text-slate-500">Next: {formatDate(row.nextRefreshAt)}</div>
    </div>
  );
}

function SourceCell({ row }: { row: TrackingDashboardRow }) {
  return (
    <>
      <div>{formatLabel(row.source)}</div>
      {row.sourceUrl ? <a className="text-orange-700 underline" href={row.sourceUrl} rel="noreferrer" target="_blank">Open evidence</a> : null}
    </>
  );
}

function RefreshSingleButton({ row, compact = false }: { row: TrackingDashboardRow; compact?: boolean }) {
  return (
    <RefreshingActionForm action={refreshSingleTrackingAction}>
      <input type="hidden" name="trackingNumber" value={row.trackingNumber} />
      <button className={`rounded-md border border-slate-300 font-medium text-slate-700 hover:bg-slate-50 ${compact ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs"}`} type="submit">
        Refresh Now
      </button>
    </RefreshingActionForm>
  );
}

function ArchiveTrackingButton({ row, compact = false }: { row: TrackingDashboardRow; compact?: boolean }) {
  return (
    <RefreshingActionForm action={archiveTrackingNumberAction}>
      <input type="hidden" name="trackingNumber" value={row.trackingNumber} />
      <button className={`rounded-md border border-amber-300 font-medium text-amber-800 hover:bg-amber-50 ${compact ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs"}`} type="submit">
        Archive
      </button>
    </RefreshingActionForm>
  );
}

function DeleteTrackingButton({ row, compact = false }: { row: TrackingDashboardRow; compact?: boolean }) {
  return (
    <RefreshingActionForm action={deleteTrackingNumberAction}>
      <input type="hidden" name="trackingNumber" value={row.trackingNumber} />
      <button className={`rounded-md border border-red-200 font-medium text-red-700 hover:bg-red-50 ${compact ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs"}`} type="submit">
        Delete
      </button>
    </RefreshingActionForm>
  );
}

function Metric({ label, value, hint, tone = "neutral" }: { label: string; value: number; hint?: string; tone?: Tone }) {
  const toneClasses = tone === "danger"
    ? "border-red-200 bg-red-50"
    : tone === "warning"
      ? "border-amber-200 bg-amber-50"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50"
        : tone === "blue"
          ? "border-blue-200 bg-blue-50"
          : "border-slate-200 bg-white";
  const labelClasses = tone === "blue" ? "text-blue-700" : "text-slate-500";
  const valueClasses = tone === "blue" ? "text-blue-900" : "text-slate-900";
  const hintClasses = tone === "blue" ? "text-blue-700" : "text-slate-500";
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${toneClasses}`}>
      <div className={`text-xs uppercase tracking-wide ${labelClasses}`}>{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${valueClasses}`}>{value}</div>
      {hint ? <div className={`mt-1 text-xs ${hintClasses}`}>{hint}</div> : null}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === "DELIVERED"
    ? "bg-emerald-100 text-emerald-800"
    : status === "OUT_FOR_DELIVERY"
      ? "bg-cyan-100 text-cyan-800"
    : status === "IN_TRANSIT"
      ? "bg-blue-100 text-blue-800"
    : status === "FAILED" || status === "EXCEPTION"
        ? "bg-red-100 text-red-800"
        : status === "INFO_RECEIVED"
          ? "bg-yellow-100 text-yellow-800"
          : status === "PENDING"
            ? "bg-slate-100 text-slate-700"
            : "bg-slate-100 text-slate-700";
  return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${tone}`}>{formatLabel(status)}</span>;
}

function RefreshBadge({ row }: { row: TrackingDashboardRow }) {
  const tone = row.refreshStatus === "FAILED"
    ? "border-red-200 bg-red-50 text-red-700"
    : row.refreshStatus === "SUCCESS"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-slate-200 bg-slate-50 text-slate-700";
  return <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${tone}`}>{formatLabel(row.refreshStatus)}</span>;
}

function formatCarrier(value: string | null) {
  if (!value) return "Auto-Detect";
  const normalized = value.replace(/-?tracking$/i, "").replace(/[_-]+/g, " ").trim();
  if (/^ups$/i.test(normalized)) return "UPS";
  if (/^canada post$/i.test(normalized)) return "Canada Post";
  if (/^china post$/i.test(normalized)) return "China Post";
  return titleCase(normalized);
}

function formatLabel(value: string) {
  return titleCase(value.replace(/[_-]+/g, " ").toLowerCase());
}

function titleCase(value: string) {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function formatDays(value: number | null) {
  if (value === null) return "—";
  return `${value.toFixed(1).replace(/\.0$/, "")}d`;
}

function formatDate(value: Date | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(value);
}
