import { DashboardTable } from "@/components/dashboard-table";
import { calculatePricedItemValuations, groupPricedItemValuationsByItemType } from "@/modules/inventory/valuation";
import { getActivePricedItemValuationInputs } from "@/modules/inventory/pricing";
import { formatQuantity } from "@/modules/inventory/quantity-format";
import { requirePermission } from "@/modules/auth/permissions";

export const dynamic = "force-dynamic";

// getActivePricedItemValuationInputs owns the active-item query, including lifecycleStatus: { not: "OBSOLETE" }, so this page matches dashboard valuation inputs.
export default async function ValuationPage() {
  await requirePermission("accounting:view");
  const itemValuation = calculatePricedItemValuations(await getActivePricedItemValuationInputs());
  const valuationGroups = groupPricedItemValuationsByItemType(itemValuation.rows);
  const valueConcentrationRows = [...itemValuation.rows]
    .sort((left, right) => right.value - left.value)
    .slice(0, 5);
  const valueConcentrationTotal = valueConcentrationRows.reduce((total, row) => total + row.value, 0);
  const valueConcentrationLongTail = Math.max(0, itemValuation.totalValue - valueConcentrationTotal);
  const valueConcentrationLargest = valueConcentrationRows[0] ?? null;
  const valueConcentrationDenominator = Math.max(1, itemValuation.totalValue);
  const valueConcentrationTopShare = percentOfTotal(valueConcentrationTotal, valueConcentrationDenominator);
  const valueConcentrationLargestShare = valueConcentrationLargest
    ? percentOfTotal(valueConcentrationLargest.value, valueConcentrationDenominator)
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Inventory Valuation</h1>
        <p className="text-sm text-slate-600">
          Automatically includes every active item with accounting landed-cost evidence or an estimated unit price. Quantity is ledger-derived from immutable item movements; value is quantity × price per unit. Priced rows are grouped by item type using the shared catalog rules, so future items fall into the right section automatically.
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
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-medium">Value Concentration</h2>
            <p className="text-xs text-slate-500">Top priced stock positions by share of total ledger-derived inventory value, for purchasing/accounting review.</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">Read-Only</span>
        </div>
        {valueConcentrationRows.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No priced stock value to graph yet.</p>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Top 5 Share</div>
                <div className="mt-1 text-xl font-semibold text-slate-900">{valueConcentrationTopShare}%</div>
                <div className="mt-1 text-xs text-slate-500">USD {valueConcentrationTotal.toFixed(2)} of USD {itemValuation.totalValue.toFixed(2)}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Largest Position</div>
                <div className="mt-1 truncate text-xl font-semibold text-slate-900" title={valueConcentrationLargest?.description}>{valueConcentrationLargest?.sku}</div>
                <div className="mt-1 text-xs text-slate-500">{valueConcentrationLargestShare}% of priced value</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Long Tail</div>
                <div className="mt-1 text-xl font-semibold text-slate-900">USD {valueConcentrationLongTail.toFixed(2)}</div>
                <div className="mt-1 text-xs text-slate-500">Remaining {Math.max(0, itemValuation.rows.length - valueConcentrationRows.length)} priced rows</div>
              </div>
            </div>

            <div aria-label="Value concentration share of total priced inventory" className="overflow-hidden rounded-full bg-slate-100">
              <div className="flex h-3 w-full">
                {valueConcentrationRows.map((row, index) => (
                  <div
                    key={row.itemId}
                    className={concentrationSegmentClass(index)}
                    style={{ width: `${Math.max(1, percentOfTotal(row.value, valueConcentrationDenominator))}%` }}
                    title={`${row.sku}: ${percentOfTotal(row.value, valueConcentrationDenominator)}% · ${row.currency} ${row.value.toFixed(2)}`}
                  />
                ))}
                {valueConcentrationLongTail > 0 ? (
                  <div
                    className="bg-slate-300"
                    style={{ width: `${Math.max(1, percentOfTotal(valueConcentrationLongTail, valueConcentrationDenominator))}%` }}
                    title={`Long tail: ${percentOfTotal(valueConcentrationLongTail, valueConcentrationDenominator)}% · USD ${valueConcentrationLongTail.toFixed(2)}`}
                  />
                ) : null}
              </div>
            </div>

            <div className="space-y-3">
              {valueConcentrationRows.map((row, index) => {
                const share = percentOfTotal(row.value, valueConcentrationDenominator);
                return (
                  <div key={row.itemId}>
                    <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                      <span className="truncate font-medium text-slate-700" title={row.description}>{index + 1}. {row.sku}</span>
                      <span className="font-mono text-slate-600">{share}% · {row.currency} {row.value.toFixed(2)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full rounded-full ${concentrationSegmentClass(index)}`} style={{ width: `${Math.max(3, share)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Concentration Reading: the top {valueConcentrationRows.length} priced stock positions hold {valueConcentrationTopShare}% of current inventory value. Use this to spot which SKUs dominate valuation risk before purchasing, landed-cost, or accounting review.
            </p>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-medium">Priced Item Valuation by Item Type</h2>
          <p className="text-xs text-slate-500">Each section follows the same item-type grouping used across item pickers and the active catalog.</p>
        </div>
        {valuationGroups.length === 0 ? (
          <DashboardTable
            title="Priced Item Valuation"
            columns={valuationColumns}
            rows={[]}
          />
        ) : valuationGroups.map((group) => (
          <DashboardTable
            key={group.key}
            title={`${group.label} · ${group.rows.length} ${group.rows.length === 1 ? "item" : "items"} · USD $${group.totalValue.toFixed(2)}`}
            columns={valuationColumns}
            rows={formatValuationRows(group.rows)}
          />
        ))}
      </section>
    </div>
  );
}

const valuationColumns = ["SKU", "Description", "Quantity", "Price/Unit", "Price Source", "Value"];

function formatValuationRows(rows: Array<{
  sku: string;
  description: string;
  quantity: number;
  currency: string;
  unitCost: number;
  value: number;
  costSourceLabel?: string | null;
  costSourceRefs: string[];
}>) {
  return rows.map((row) => [
    row.sku,
    row.description,
    formatQuantity(row.quantity, { fixed: true }),
    `${row.currency} ${row.unitCost.toFixed(2)}`,
    formatCostSource(row),
    `${row.currency} ${row.value.toFixed(2)}`
  ]);
}

function formatCostSource(row: { costSourceLabel?: string | null; costSourceRefs: string[] }) {
  if (!row.costSourceLabel) return "Unpriced";
  if (row.costSourceLabel.startsWith("BOM rollup")) return row.costSourceLabel;
  const refs = row.costSourceRefs.length > 0 ? ` · ${row.costSourceRefs.slice(0, 2).join(" | ")}` : "";
  const extra = row.costSourceRefs.length > 2 ? ` +${row.costSourceRefs.length - 2} more` : "";
  return `${row.costSourceLabel}${refs}${extra}`;
}

function percentOfTotal(value: number, total: number) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round((value / total) * 100);
}

function concentrationSegmentClass(index: number) {
  const classes = [
    "bg-cyan-500",
    "bg-emerald-500",
    "bg-teal-500",
    "bg-sky-500",
    "bg-indigo-400"
  ];
  return classes[index % classes.length];
}
