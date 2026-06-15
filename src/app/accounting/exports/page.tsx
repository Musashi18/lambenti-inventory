import Link from "next/link";
import { getGstHstExportRows } from "@/modules/accounting/tax";
import { requirePermission } from "@/modules/auth/permissions";

export const dynamic = "force-dynamic";

function money(value: number, currency = "USD") {
  return `${currency}${value.toFixed(2)}`;
}

export default async function AccountingExportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requirePermission("accounting:view");
  const params = await searchParams;
  const from = parseDate(params.from);
  const to = parseDate(params.to, true);
  const rows = await getGstHstExportRows({ from, to });
  const query = new URLSearchParams();
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">GST/HST exports</h1>
          <p className="max-w-3xl text-sm text-slate-600">
            Export AP invoice tax-support rows with source evidence, warnings, and recoverable/non-recoverable tax splits for accountant review. Posted journal CSV is available on the journal entries page.
          </p>
        </div>
        <Link href="/accounting" className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Back to accounting</Link>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <form className="grid gap-3 md:grid-cols-[auto_auto_auto_auto] md:items-end">
          <label className="grid gap-1 text-sm">From<input name="from" type="date" defaultValue={params.from} className="rounded-md border border-slate-300 px-2 py-1" /></label>
          <label className="grid gap-1 text-sm">To<input name="to" type="date" defaultValue={params.to} className="rounded-md border border-slate-300 px-2 py-1" /></label>
          <button className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Filter</button>
          <Link href={`/api/accounting/exports/gst-hst?${query.toString()}`} className="rounded-md bg-ink px-3 py-2 text-center text-sm font-medium text-white">Download GST/HST CSV</Link>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3"><h2 className="font-medium">Export rows</h2></div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Supplier</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Tax</th><th className="px-4 py-3">Evidence / warnings</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? <tr><td className="px-4 py-6 text-slate-500" colSpan={5}>No GST/HST rows in this range.</td></tr> : rows.map((row) => (
                <tr key={row.invoiceId} className="align-top">
                  <td className="px-4 py-3 font-medium">{row.invoiceNumber}</td>
                  <td className="px-4 py-3">{row.supplierName}<div className="text-xs text-slate-500">GST/HST {row.supplierTaxRegistrationNumber ?? "missing"}</div></td>
                  <td className="px-4 py-3">{row.invoiceDate}</td>
                  <td className="px-4 py-3">recoverable {money(row.gstHstRecoverable, row.currency)}<div className="text-xs text-slate-500">non-recoverable {money(row.gstHstNonRecoverable, row.currency)}</div></td>
                  <td className="px-4 py-3 text-xs text-slate-600">{row.sourceDocumentHash ? `SHA ${row.sourceDocumentHash.slice(0, 12)}…` : "No hash"}{row.warnings.length ? <ul className="mt-1 list-disc pl-4 text-amber-700">{row.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}</td>
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
