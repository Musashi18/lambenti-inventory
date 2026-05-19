import { DashboardTable } from "@/components/dashboard-table";
import { getSupplierComparison } from "@/modules/suppliers/service";

export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const offers = await getSupplierComparison();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Supplier comparison</h1>
        <p className="text-sm text-slate-600">Offer, MOQ, lead time, and reliability side by side.</p>
      </div>
      <DashboardTable
        title="Supplier offers"
        columns={["Item", "Supplier", "MOQ", "Lead time", "Reliability"]}
        rows={offers.map((offer) => [
          offer.item.sku,
          offer.supplier.name,
          offer.moq.toString(),
          `${offer.leadTimeDays} days`,
          Number(offer.supplier.reliabilityScore).toFixed(1)
        ])}
      />
    </div>
  );
}
