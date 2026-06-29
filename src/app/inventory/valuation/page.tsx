import { DashboardTable } from "@/components/dashboard-table";
import { calculatePricedItemValuations } from "@/modules/inventory/valuation";
import { getActivePricedItemValuationInputs } from "@/modules/inventory/pricing";
import { formatQuantity } from "@/modules/inventory/quantity-format";
import { requirePermission } from "@/modules/auth/permissions";

export const dynamic = "force-dynamic";

// getActivePricedItemValuationInputs owns the active-item query, including lifecycleStatus: { not: "OBSOLETE" }, so this page matches dashboard valuation inputs.
export default async function ValuationPage() {
  await requirePermission("accounting:view");
  const itemValuation = calculatePricedItemValuations(await getActivePricedItemValuationInputs());
  const valueConcentrationRows = [...itemValuation.rows]
    .sort((left, right) => right.value - left.value)
    .slice(0, 5);
  const valueConcentrationMax = Math.max(1, ...valueConcentrationRows.map((row) => row.value));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Inventory Valuation</h1>
        <p className="text-sm text-slate-600">
          Automatically includes every active item with accounting landed-cost evidence or an estimated unit price. Quantity is ledger-derived from immutable item movements; value is quantity × price per unit.
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Priced Item Valuation</div>
          <div className="mt-1 text-2xl font-semibold">USD ${itemValuation.totalValue.toFixed(2)}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Priced active items</div>
          <div className="mt-1 text-2xl font-semibold">{itemValuation.rows.length}</div>
        </div>
      </section>

      <section className="rounded-md border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-medium">Value Concentration</h2>
            <p className="text-xs text-slate-500">Top priced stock positions by ledger-derived value, for purchasing/accounting review.</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">Read-Only</span>
        </div>
        <div className="mt-4 space-y-3">
          {valueConcentrationRows.length === 0 ? (
            <p className="text-sm text-slate-500">No priced stock value to graph yet.</p>
          ) : valueConcentrationRows.map((row) => (
            <div key={row.itemId}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                <span className="truncate font-medium text-slate-700" title={row.description}>{row.sku}</span>
                <span className="font-mono text-slate-600">{row.currency} {row.value.toFixed(2)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-500" style={{ width: `${Math.max(4, Math.round((row.value / valueConcentrationMax) * 100))}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <DashboardTable
        title="Priced Item Valuation"
        columns={["SKU", "Description", "Quantity", "Price/Unit", "Price Source", "Value"]}
        rows={itemValuation.rows.map((row) => [
          row.sku,
          row.description,
          formatQuantity(row.quantity, { fixed: true }),
          `${row.currency} ${row.unitCost.toFixed(2)}`,
          formatCostSource(row),
          `${row.currency} ${row.value.toFixed(2)}`
        ])}
      />
    </div>
  );
}

function formatCostSource(row: { costSourceLabel?: string | null; costSourceRefs: string[] }) {
  if (!row.costSourceLabel) return "Unpriced";
  if (row.costSourceLabel.startsWith("BOM rollup")) return row.costSourceLabel;
  const refs = row.costSourceRefs.length > 0 ? ` · ${row.costSourceRefs.slice(0, 2).join(" | ")}` : "";
  const extra = row.costSourceRefs.length > 2 ? ` +${row.costSourceRefs.length - 2} more` : "";
  return `${row.costSourceLabel}${refs}${extra}`;
}
