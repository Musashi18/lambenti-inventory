import Link from "next/link";
import { getJournalDashboard } from "@/modules/accounting/journals";
import { requirePermission } from "@/modules/auth/permissions";

export const dynamic = "force-dynamic";

function money(value: number, currency = "USD") {
  return `${currency}${value.toFixed(2)}`;
}

export default async function AccountingJournalsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requirePermission("accounting:view");
  const params = await searchParams;
  const from = parseDate(params.from);
  const to = parseDate(params.to, true);
  const { entries, trialBalance } = await getJournalDashboard({ from, to });
  const query = new URLSearchParams();
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Journal entries</h1>
          <p className="max-w-4xl text-sm text-slate-600">
            Posted ledger view: posted balanced journals are created only from explicit human accounting actions: AP invoice approval and AP payment reconciliation.
            Journal posting does not receive stock, change PO received quantities, import bank rows by itself, or replace source-document review.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/accounting/accounts" className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Configure GL mappings</Link>
          <Link href="/accounting" className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Back to accounting</Link>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="Posted journals" value={entries.filter((entry) => entry.status === "POSTED").length.toString()} subtext="Immutable source-linked entries" />
        <SummaryCard label="Trial balance debit" value={money(trialBalance.totalDebit)} subtext="Posted entries only" />
        <SummaryCard label="Trial balance credit" value={money(trialBalance.totalCredit)} subtext="Must match debit" />
        <SummaryCard label="Out of balance" value={money(Math.abs(trialBalance.outOfBalance))} subtext={trialBalance.outOfBalance === 0 ? "Balanced" : "Needs investigation"} tone={trialBalance.outOfBalance === 0 ? "good" : "warn"} />
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <form className="grid gap-3 md:grid-cols-[auto_auto_auto_auto_auto] md:items-end">
          <label className="grid gap-1 text-sm">From<input name="from" type="date" defaultValue={params.from} className="rounded-md border border-slate-300 px-2 py-1" /></label>
          <label className="grid gap-1 text-sm">To<input name="to" type="date" defaultValue={params.to} className="rounded-md border border-slate-300 px-2 py-1" /></label>
          <button className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Filter</button>
          <Link href={`/api/accounting/exports/journals?${query.toString()}`} className="rounded-md bg-ink px-3 py-2 text-center text-sm font-medium text-white">Download journal CSV</Link>
          <p className="text-xs text-slate-500">CSV includes entry numbers, line accounts, debit/credit, source reference, and memo for accountant review.</p>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-medium">Posting controls and setup</h2>
        <div className="mt-3 grid gap-3 text-sm text-slate-700 md:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="font-medium">AP invoice approval</div>
            <p className="mt-1 text-xs text-slate-600">Approving a received supplier invoice posts debit invoice lines/tax and credit accounts payable. Missing mappings block approval with a clear setup error.</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="font-medium">AP payment reconciliation</div>
            <p className="mt-1 text-xs text-slate-600">Reconciling an approved invoice payment posts debit accounts payable and credit bank/cash. Bank imports alone remain non-posting evidence.</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="font-medium">Required mappings</div>
            <p className="mt-1 text-xs text-slate-600">Configure INVENTORY_ASSET, TAX_RECOVERABLE, ACCOUNTS_PAYABLE, and BANK_CASH on the GL mapping page before posting journals.</p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="font-medium">Trial balance</h2>
          <p className="text-xs text-slate-500">Posted journal lines grouped by account snapshot so account renames do not rewrite old entries.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Account</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Debit</th><th className="px-4 py-3">Credit</th><th className="px-4 py-3">Net</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {trialBalance.accountBalances.length === 0 ? <tr><td className="px-4 py-6 text-slate-500" colSpan={5}>No posted journal lines in this range.</td></tr> : trialBalance.accountBalances.map((account) => (
                <tr key={account.accountCode}>
                  <td className="px-4 py-3 font-medium">{account.accountCode}<div className="text-xs text-slate-500">{account.accountName}</div></td>
                  <td className="px-4 py-3">{account.accountType}</td>
                  <td className="px-4 py-3">{money(account.debit)}</td>
                  <td className="px-4 py-3">{money(account.credit)}</td>
                  <td className="px-4 py-3">{money(account.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="font-medium">Posted entry ledger</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {entries.length === 0 ? <p className="px-4 py-6 text-sm text-slate-500">No journal entries in this range.</p> : entries.map((entry) => (
            <article key={entry.id} className="px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{entry.entryNumber} · {entry.kind}</div>
                  <div className="text-sm text-slate-600">{entry.entryDate.toISOString().slice(0, 10)} · {entry.status} · {entry.sourceReference ?? entry.sourceId}</div>
                  {entry.memo ? <div className="text-xs text-slate-500">{entry.memo}</div> : null}
                </div>
                <div className="text-right text-sm">
                  <div>Debit {money(Number(entry.totalDebit.toString()), entry.currency)}</div>
                  <div>Credit {money(Number(entry.totalCredit.toString()), entry.currency)}</div>
                </div>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead className="text-slate-500"><tr><th className="py-1 pr-3">#</th><th className="py-1 pr-3">Account</th><th className="py-1 pr-3">Description</th><th className="py-1 pr-3">Debit</th><th className="py-1 pr-3">Credit</th></tr></thead>
                  <tbody>
                    {entry.lines.map((line) => (
                      <tr key={line.id} className="border-t border-slate-100">
                        <td className="py-1 pr-3">{line.lineNo}</td>
                        <td className="py-1 pr-3 font-medium">{line.accountCodeSnapshot}<div className="text-slate-500">{line.accountNameSnapshot}</div></td>
                        <td className="py-1 pr-3">{line.description}</td>
                        <td className="py-1 pr-3">{money(Number(line.debit.toString()), entry.currency)}</td>
                        <td className="py-1 pr-3">{money(Number(line.credit.toString()), entry.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function SummaryCard({ label, value, subtext, tone }: { label: string; value: string; subtext: string; tone?: "good" | "warn" }) {
  return (
    <div className={`rounded-md border bg-white p-4 ${tone === "good" ? "border-emerald-200" : tone === "warn" ? "border-amber-300" : "border-slate-200"}`}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{subtext}</div>
    </div>
  );
}

function parseDate(value?: string, endOfDay = false) {
  if (!value) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
