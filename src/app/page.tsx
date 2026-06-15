import Link from "next/link";
import { StatCard } from "@/components/stat-card";
import { DashboardTable } from "@/components/dashboard-table";
import { getDashboardSummary } from "@/modules/dashboard/service";
import { requirePermission } from "@/modules/auth/permissions";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requirePermission("item:view");
  const summary = await getDashboardSummary();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Operations dashboard</h1>
        <p className="text-sm text-slate-600">
          Inventory, shortages, and purchasing readiness.
        </p>
      </div>

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
        <StatCard label="Upcoming shortages" value={summary.shortages.length} />
        <StatCard label="Inventory valuation" value={`USD $${summary.inventoryValuation.toFixed(2)}`} />
        <StatCard label="Incoming orders" value={summary.incomingOrders.length} />
        <StatCard label="Review actions" value={summary.humanReviewActions.length} />
        <StatCard label="Automation findings" value={summary.openAutomationFindings.length} />
        <StatCard label="Automation failures" value={summary.failedAutomationRuns.length} />
      </div>

      <details className="rounded-md border border-slate-200 bg-white">
        <summary className="cursor-pointer list-none border-b border-slate-200 px-4 py-3 marker:hidden">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-medium">Human approval queue</h2>
              <p className="text-sm text-slate-500">
                Automatic tracking can draft order/invoice metadata, but these actions keep money, unmatched imports, and stock receiving under human review.
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">Collapsed by default · {summary.humanReviewActions.length}</span>
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
        title="In-stock quantities"
        columns={["SKU", "Description", "On hand", "Reserved", "Available", "Reorder", "Target"]}
        rows={summary.stockItems
          .filter((item) => item.onHand !== 0 || item.reserved !== 0 || item.available !== 0)
          .map((item) => [
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
        title="Low stock dashboard"
        columns={["SKU", "Description", "On hand", "Reorder point"]}
        rows={summary.lowStockItems.map((item) => [
          item.sku,
          item.description,
          item.onHand.toString(),
          item.reorderPoint.toString()
        ])}
      />

      <DashboardTable
        title="Upcoming shortages"
        columns={["SKU", "Demand", "Available", "Shortage"]}
        rows={summary.shortages.map((item) => [
          item.sku,
          item.demand.toString(),
          item.available.toString(),
          item.shortage.toString()
        ])}
      />
    </div>
  );
}
