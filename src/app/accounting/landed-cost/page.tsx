import Link from "next/link";
import { getLandedCostRows } from "@/modules/accounting/landed-cost";
import { requirePermission } from "@/modules/auth/permissions";

export const dynamic = "force-dynamic";

function money(currency: string, value: number) {
  return `${currency}${value.toFixed(2)}`;
}

export default async function LandedCostPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requirePermission("accounting:view");
  const params = await searchParams;
  const from = parseDate(params.from);
  const to = parseDate(params.to, true);
  const rows = await getLandedCostRows({ from, to });
  const query = new URLSearchParams();
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Landed-Cost Allocation</h1>
          <p className="max-w-3xl text-sm text-slate-600">
            Read-only report allocating freight, duty, brokerage, other costs, and non-recoverable tax across invoice lines by line value. Recoverable GST/HST is shown but excluded from inventory landed cost.
          </p>
        </div>
        <Link href="/accounting" className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Back to Accounting</Link>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <form className="grid gap-3 md:grid-cols-[auto_auto_auto_auto] md:items-end">
          <label className="grid gap-1 text-sm">From<input name="from" type="date" defaultValue={params.from} className="rounded-md border border-slate-300 px-2 py-1" /></label>
          <label className="grid gap-1 text-sm">To<input name="to" type="date" defaultValue={params.to} className="rounded-md border border-slate-300 px-2 py-1" /></label>
          <button className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Filter</button>
          <Link href={`/api/accounting/exports/landed-cost?${query.toString()}`} className="rounded-md bg-ink px-3 py-2 text-center text-sm font-medium text-white">Download Landed-Cost CSV</Link>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3"><h2 className="font-medium">Allocated Invoice Lines</h2></div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Invoice / Item</th><th className="px-4 py-3">Line Subtotal</th><th className="px-4 py-3">Allocated Costs</th><th className="px-4 py-3">Landed Unit</th><th className="px-4 py-3">Review</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? <tr><td className="px-4 py-6 text-slate-500" colSpan={5}>No landed-cost rows in this range.</td></tr> : rows.map((row) => (
                <tr key={row.invoiceLineId} className="align-top">
                  <td className="px-4 py-3"><div className="font-medium">{row.invoiceNumber}</div><div className="text-xs text-slate-600">{row.sku ?? row.description} · qty {row.quantity}</div></td>
                  <td className="px-4 py-3">{money(row.currency, row.lineSubtotal)}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    freight {money(row.currency, row.allocatedFreight)} · duty {money(row.currency, row.allocatedDuty)} · brokerage {money(row.currency, row.allocatedBrokerage)}
                    <div>non-recoverable tax {money(row.currency, row.allocatedNonRecoverableTax)} · recoverable excluded {money(row.currency, row.recoverableTaxExcluded)}</div>
                    <div>customs/evidence paid {money(row.currency, row.allocatedAttachedLandedCostEvidence)}</div>
                    {row.attachedLandedCostEvidenceRefs.length ? <div className="mt-1 text-[11px] text-slate-500">{row.attachedLandedCostEvidenceRefs.join("; ")}</div> : null}
                  </td>
                  <td className="px-4 py-3">{money(row.currency, row.landedTotal)}<div className="text-xs text-slate-500">unit {row.currency}{row.landedUnitCost.toFixed(2)}</div></td>
                  <td className="px-4 py-3 text-xs text-amber-700">{row.warnings.length ? row.warnings.join("; ") : "OK"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function parseDate(value?: string, endOfDay = false) {
  if (!value) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
