import { DashboardTable } from "@/components/dashboard-table";
import { getPurchaseRecommendations } from "@/modules/purchasing/service";
import { requirePermission } from "@/modules/auth/permissions";

export const dynamic = "force-dynamic";

export default async function PurchaseRecommendationsPage() {
  await requirePermission("purchaseRecommendation:view");
  const recommendations = await getPurchaseRecommendations();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Purchase recommendations</h1>
        <p className="text-sm text-slate-600">Items below reorder point with suggested quantities.</p>
      </div>
      <DashboardTable
        title="Recommended purchases"
        columns={["SKU", "Available", "Reorder point", "Target stock", "Recommended order"]}
        rows={recommendations.map((item) => [
          item.sku,
          item.available.toString(),
          item.reorderPoint.toString(),
          item.targetStock.toString(),
          item.recommendedOrderQuantity.toString()
        ])}
      />
    </div>
  );
}
