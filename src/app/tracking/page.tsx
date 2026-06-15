import { RefreshingActionForm } from "@/app/refreshing-action-form";
import {
  refreshAllTrackingAction,
  refreshSingleTrackingAction,
  saveManualTrackingNumbersAction
} from "./actions";
import { TrackingAutoRefresh } from "./tracking-auto-refresh";
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

export default async function TrackingPage() {
  const [dashboard, linkOptions, leadTimeLog] = await Promise.all([
    getTrackingDashboard(),
    getTrackingLinkOptions(),
    getLeadTimeLog()
  ]);

  return (
    <main className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-orange-600">Shipment logistics</p>
            <h1 className="mt-1 text-3xl font-semibold text-slate-900">Tracking workbench</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Paste tracking numbers, shipment-notification emails, or Alibaba order-detail links into the manual drop box below. Tracking numbers are retained as shipment evidence, linked to purchase orders by explicit PO selection or Alibaba external order ID, and refreshed through the configured tracking service. This is metadata only: it does not receive stock or confirm delivery.
            </p>
          </div>
          <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
            <div className="font-medium text-slate-900">Tracking service connection</div>
            <div className={dashboard.service.configured ? "text-green-700" : "text-amber-700"}>
              {dashboard.service.configured ? `${dashboard.service.provider} configured` : `${dashboard.service.provider} not configured`}
            </div>
            <div className="text-xs text-slate-500">
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
            <TrackingAutoRefresh enabled={dashboard.service.configured} intervalMinutes={dashboard.service.refreshIntervalMinutes} />
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-5">
        <Metric label="Saved numbers" value={dashboard.summary.total} />
        <Metric label="Due refresh" value={dashboard.summary.due} />
        <Metric label="Delivered" value={dashboard.summary.delivered} />
        <Metric label="Needs config" value={dashboard.summary.needsConfiguration} />
        <Metric label="Failed refresh" value={dashboard.summary.failed} tone={dashboard.summary.failed > 0 ? "danger" : "neutral"} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)]">
        <ManualTrackingDropBox linkOptions={linkOptions} />
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Automatic refresh</h2>
            <p className="mt-2 text-sm text-slate-600">
              Refreshes due, non-delivered tracking numbers through the configured service. Delivered shipments are no longer polled.
            </p>
            <RefreshingActionForm action={refreshAllTrackingAction} className="mt-4">
              <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800" type="submit">
                Refresh due tracking statuses
              </button>
            </RefreshingActionForm>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5">
          <h2 className="text-lg font-semibold text-slate-900">Active tracking numbers</h2>
          <p className="mt-1 text-sm text-slate-600">Open, non-delivered shipment numbers that remain eligible for refresh. Delivered shipments are removed from this active list but retained in the history below.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Tracking number</th>
                <th className="px-4 py-3">Linked order</th>
                <th className="px-4 py-3">Carrier</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Latest event</th>
                <th className="px-4 py-3">Refresh</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dashboard.rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">No active tracking numbers. Delivered tracking information is retained in the history below.</td>
                </tr>
              ) : dashboard.rows.map((row) => (
                <ActiveTrackingRow key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5">
          <h2 className="text-lg font-semibold text-slate-900">Delivered tracking history</h2>
          <p className="mt-1 text-sm text-slate-600">Delivered shipment records are retained for evidence and carrier history. Total ship time is measured from the first carrier event to delivery when carrier events are available.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Tracking number</th>
                <th className="px-4 py-3">Linked order</th>
                <th className="px-4 py-3">Carrier</th>
                <th className="px-4 py-3">Delivered</th>
                <th className="px-4 py-3">Total ship time</th>
                <th className="px-4 py-3">Latest event</th>
                <th className="px-4 py-3">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dashboard.deliveredRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">No delivered tracking history yet.</td>
                </tr>
              ) : dashboard.deliveredRows.map((row) => (
                <DeliveredTrackingRow key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <LeadTimeLearningLog log={leadTimeLog} />
    </main>
  );
}

function LeadTimeLearningLog({ log }: { log: LeadTimeLog }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-orange-600">Reorder forecasting input</p>
        <h2 className="mt-1 text-lg font-semibold text-slate-900">Lead-time learning log</h2>
        <p className="mt-1 text-sm text-slate-600">
          Completed tracking/receiving samples update item and supplier lead-time days automatically. Expand an item to audit quantity ordered, payment/order start, receipt or delivery endpoint, tracking evidence, and shipping time before those averages are used as reorder buffers.
        </p>
      </div>
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
          <div className="p-5 text-sm text-slate-500">No completed lead-time samples yet. Samples appear after linked orders have carrier delivery or human receiving evidence.</div>
        ) : log.items.map((item) => <LeadTimeLogItemDetails key={item.itemId} item={item} />)}
      </div>
    </section>
  );
}

function LeadTimeLogItemDetails({ item }: { item: LeadTimeLogItem }) {
  return (
    <details className="group p-5">
      <summary className="flex cursor-pointer list-none flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="font-medium text-slate-900">{item.itemSku}</div>
          <div className="text-sm text-slate-600">{item.itemDescription}</div>
          <div className="mt-1 text-xs text-slate-500">
            Current item lead time {item.currentLeadTimeDays}d · weighted average {formatDays(item.weightedAverageLeadTimeDays)} across {item.totalQuantityOrdered} ordered · shipping avg {formatDays(item.averageShipTimeDays)}
          </div>
        </div>
        <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700">
          {item.sampleCount} sample{item.sampleCount === 1 ? "" : "s"}
        </span>
      </summary>
      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-100">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Order</th>
              <th className="px-3 py-2">Supplier</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">Lead time</th>
              <th className="px-3 py-2">Start → end</th>
              <th className="px-3 py-2">Shipping</th>
              <th className="px-3 py-2">Tracking evidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {item.entries.map((entry) => <LeadTimeLogEntryRow key={`${entry.purchaseOrderId}-${entry.itemId}-${entry.endAt.toISOString()}`} entry={entry} />)}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function LeadTimeLogEntryRow({ entry }: { entry: LeadTimeLogEntry }) {
  return (
    <tr className="align-top">
      <td className="px-3 py-2">
        <div className="font-mono text-xs text-slate-900">{entry.externalOrderId ?? entry.purchaseOrderId}</div>
        <div className="text-xs text-slate-500">PO {entry.purchaseOrderId}</div>
      </td>
      <td className="px-3 py-2 text-slate-700">{entry.supplierName}</td>
      <td className="px-3 py-2 text-slate-700">
        <div>{entry.quantityOrdered} ordered</div>
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
        ) : <div className="text-xs text-slate-400">No carrier range</div>}
      </td>
      <td className="px-3 py-2 font-mono text-xs text-slate-700">
        {entry.trackingNumbers.length > 0 ? entry.trackingNumbers.join(", ") : "—"}
      </td>
    </tr>
  );
}

function ManualTrackingDropBox({ linkOptions }: { linkOptions: TrackingLinkOption[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Manual tracking drop box</h2>
      <p className="mt-2 text-sm text-slate-600">
        Paste one or more tracking numbers, a shipment notification email, or an Alibaba order-details URL. Best linking order: choose the receiving PO when you know it; otherwise include the Alibaba order number so the app can match the saved email import / receiving entry. Lead time uses the payment/order email date as the start and the human receiving date first, falling back to carrier delivery when receipt has not happened yet.
      </p>
      <RefreshingActionForm action={saveManualTrackingNumbersAction} className="mt-4 space-y-4">
        <label className="block text-sm font-medium text-slate-700">
          Tracking numbers / shipment email text
          <textarea
            className="mt-1 min-h-36 w-full rounded-lg border border-dashed border-orange-300 bg-orange-50/40 px-3 py-3 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
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
            Alibaba / supplier order number
            <input name="externalOrderId" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900" placeholder="304716450001023166" />
          </label>
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
            Supplier name (optional)
            <input name="supplierName" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900" placeholder="Supplier from shipment email" />
          </label>
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
            Evidence URL (optional)
            <input name="sourceUrl" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900" placeholder="https://biz.alibaba.com/ta/detail.htm?..." type="url" />
          </label>
        </div>
        <button className="rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700" type="submit">
          Save tracking numbers
        </button>
      </RefreshingActionForm>
    </div>
  );
}

function ActiveTrackingRow({ row }: { row: TrackingDashboardRow }) {
  return (
    <tr data-testid="tracking-row" className="align-top">
      <td className="px-4 py-3 font-mono text-slate-900">{row.trackingNumber}</td>
      <td className="px-4 py-3">
        <div className="font-medium text-slate-900">{row.linkedOrderLabel}</div>
        {row.supplierName ? <div className="text-xs text-slate-500">{row.supplierName}</div> : null}
      </td>
      <td className="px-4 py-3 text-slate-700">{row.carrier ?? "Auto"}</td>
      <td className="px-4 py-3">
        <StatusBadge status={row.currentStatus} />
        {row.statusDescription ? <div className="mt-1 max-w-xs text-xs text-slate-500">{row.statusDescription}</div> : null}
      </td>
      <td className="px-4 py-3 text-slate-700"><LatestEvent row={row} /></td>
      <td className="px-4 py-3 text-xs text-slate-600">
        <div>{row.refreshStatus}</div>
        <div>Last: {formatDate(row.lastCheckedAt)}</div>
        <div>Next: {formatDate(row.nextRefreshAt)}</div>
        {row.refreshError ? <div className="mt-1 max-w-xs text-red-700">{row.refreshError}</div> : null}
      </td>
      <td className="px-4 py-3 text-xs text-slate-600"><SourceCell row={row} /></td>
      <td className="px-4 py-3">
        <RefreshingActionForm action={refreshSingleTrackingAction}>
          <input type="hidden" name="trackingNumber" value={row.trackingNumber} />
          <button className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50" type="submit">
            Refresh now
          </button>
        </RefreshingActionForm>
      </td>
    </tr>
  );
}

function DeliveredTrackingRow({ row }: { row: TrackingDashboardRow }) {
  return (
    <tr data-testid="delivered-tracking-row" className="align-top">
      <td className="px-4 py-3 font-mono text-slate-900">{row.trackingNumber}</td>
      <td className="px-4 py-3">
        <div className="font-medium text-slate-900">{row.linkedOrderLabel}</div>
        {row.supplierName ? <div className="text-xs text-slate-500">{row.supplierName}</div> : null}
      </td>
      <td className="px-4 py-3 text-slate-700">{row.carrier ?? "Auto"}</td>
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

function SourceCell({ row }: { row: TrackingDashboardRow }) {
  return (
    <>
      <div>{row.source}</div>
      {row.sourceUrl ? <a className="text-orange-700 underline" href={row.sourceUrl} rel="noreferrer" target="_blank">Open evidence</a> : null}
    </>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "danger" }) {
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${tone === "danger" ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === "DELIVERED"
    ? "bg-green-100 text-green-800"
    : status === "IN_TRANSIT"
      ? "bg-blue-100 text-blue-800"
      : status === "FAILED" || status === "EXCEPTION"
        ? "bg-red-100 text-red-800"
        : "bg-slate-100 text-slate-700";
  return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${tone}`}>{status}</span>;
}

function formatDays(value: number | null) {
  if (value === null) return "—";
  return `${value.toFixed(1).replace(/\.0$/, "")}d`;
}

function formatDate(value: Date | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(value);
}
