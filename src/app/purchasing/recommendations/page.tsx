import { RefreshingActionForm } from "@/app/refreshing-action-form";
import { hasPermission, requirePermission } from "@/modules/auth/permissions";
import { getPurchaseRecommendations } from "@/modules/purchasing/service";
import { createDraftPurchaseRequestFromRecommendationAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function PurchaseRecommendationsPage() {
  const actor = await requirePermission("purchaseRecommendation:view");
  const canDraftPurchaseRequests = hasPermission(actor, "purchaseRequest:draft");
  const recommendations = await getPurchaseRecommendations();
  const totalRecommendedUnits = recommendations.reduce((total, item) => total + item.recommendedOrderQuantity, 0);
  const missingSupplierCount = recommendations.filter((item) => !item.preferredSupplierId).length;
  const missingPriceCount = recommendations.filter((item) => !item.estimatedUnitCost).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Purchase Recommendations</h1>
          <p className="text-sm text-slate-600">
            Continuous funnel from low-stock evidence to draft purchase request. This creates reviewable PRs only; it does not order, pay, or receive stock.
          </p>
        </div>
        <a href="/purchasing/requests" className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Review PR Approvals</a>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <Metric title="Recommendation rows" value={recommendations.length.toString()} detail="below reorder after incoming/open PRs" />
        <Metric title="Units to draft" value={totalRecommendedUnits.toString()} detail="target stock gap" />
        <Metric title="Missing supplier" value={missingSupplierCount.toString()} detail="assign before PO conversion" tone={missingSupplierCount > 0 ? "warning" : "ok"} />
        <Metric title="Missing price" value={missingPriceCount.toString()} detail="blocks draft PO conversion" tone={missingPriceCount > 0 ? "warning" : "ok"} />
      </section>

      <section className="rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="font-medium">Recommendation → Draft Purchase Request Queue</h2>
          <p className="text-xs text-slate-500">Review evidence, supplier, incoming coverage, and price confidence before creating a draft PR.</p>
        </div>
        <div className="divide-y divide-slate-100">
          {recommendations.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-500">No recommendation currently needs a draft purchase request.</div>
          ) : recommendations.map((item) => {
            const priceLabel = item.estimatedUnitCost ? `USD ${Number(item.estimatedUnitCost).toFixed(4)} (${item.costConfidence ?? "UNKNOWN"})` : "Missing price evidence";
            return (
              <article key={item.itemId} className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-slate-900">{item.sku}</h3>
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800">Low stock</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{item.description}</p>
                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-5">
                    <Metric title="Available" value={item.available.toString()} compact />
                    <Metric title="Reorder Point" value={item.reorderPoint.toString()} compact />
                    <Metric title="Target" value={item.targetStock.toString()} compact />
                    <Metric title="Incoming" value={item.incomingQty.toString()} compact />
                    <Metric title="Open PR qty" value={item.openDraftOrPendingRequestQty.toString()} compact />
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-slate-600 md:grid-cols-3">
                    <div><span className="font-medium text-slate-800">Supplier:</span> {item.preferredSupplierName ?? "Unassigned"}</div>
                    <div><span className="font-medium text-slate-800">Supplier SKU:</span> {item.supplierSku ?? "—"}</div>
                    <div><span className="font-medium text-slate-800">Price evidence:</span> {priceLabel}</div>
                  </div>
                </div>
                {canDraftPurchaseRequests ? (
                  <RefreshingActionForm action={createDraftPurchaseRequestFromRecommendationAction} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <input type="hidden" name="itemId" value={item.itemId} />
                    {item.preferredSupplierId ? <input type="hidden" name="supplierId" value={item.preferredSupplierId} /> : null}
                    <label className="space-y-1 text-xs font-medium text-slate-700">
                      Draft PR Quantity
                      <input name="quantity" type="number" min="1" step="1" defaultValue={item.recommendedOrderQuantity} className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm" required />
                    </label>
                    <input type="hidden" name="rationale" value={`Low-stock recommendation for ${item.sku}: available ${item.available}, reorder point ${item.reorderPoint}, target ${item.targetStock}, incoming ${item.incomingQty}, open PR qty ${item.openDraftOrPendingRequestQty}.`} />
                    <button className="mt-3 w-full rounded-md bg-ink px-3 py-2 text-sm font-medium text-white">Create Draft PR</button>
                    <p className="mt-2 text-xs text-slate-500">Human approval and draft-PO conversion remain separate gates.</p>
                  </RefreshingActionForm>
                ) : (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">View-only: draft PR controls hidden.</div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Metric({ title, value, detail, tone = "neutral", compact = false }: { title: string; value: string; detail?: string; tone?: "neutral" | "warning" | "ok"; compact?: boolean }) {
  const toneClass = tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-900" : tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-white text-slate-900";
  return (
    <div className={`rounded-md border p-3 ${toneClass} ${compact ? "bg-slate-50" : ""}`}>
      <div className="text-xs uppercase tracking-wide opacity-70">{title}</div>
      <div className={`${compact ? "text-lg" : "text-2xl"} mt-1 font-semibold`}>{value}</div>
      {detail ? <div className="text-xs opacity-75">{detail}</div> : null}
    </div>
  );
}
