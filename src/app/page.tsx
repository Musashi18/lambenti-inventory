import { StatCard } from "@/components/stat-card";
import { DashboardTable } from "@/components/dashboard-table";
import { getDashboardSummary } from "@/modules/dashboard/service";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
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
        <StatCard label="Upcoming shortages" value={summary.shortages.length} />
        <StatCard label="Inventory valuation" value={`$${summary.inventoryValuation.toFixed(2)}`} />
        <StatCard label="Incoming orders" value={summary.incomingOrders.length} />
      </div>

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
