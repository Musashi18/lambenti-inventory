import { DashboardTable } from "@/components/dashboard-table";
import { getIncomingOrders } from "@/modules/purchasing/service";
import { requirePermission } from "@/modules/auth/permissions";

export const dynamic = "force-dynamic";

export default async function IncomingPage() {
  await requirePermission("receiving:confirm");
  const orders = await getIncomingOrders();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Incoming inventory tracker</h1>
        <p className="text-sm text-slate-600">Open purchase orders and expected arrivals.</p>
      </div>
      <DashboardTable
        title="Incoming purchase orders"
        columns={["Supplier", "Status", "Expected", "Lines"]}
        rows={orders.map((order) => [
          order.supplier.name,
          order.status,
          order.expectedAt?.toISOString().slice(0, 10) ?? "TBD",
          order.lines.length.toString()
        ])}
      />
    </div>
  );
}
