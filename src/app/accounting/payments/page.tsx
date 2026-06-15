import Link from "next/link";
import { getPaymentReconciliationDashboard } from "@/modules/accounting/payments";
import { hasPermission, requirePermission } from "@/modules/auth/permissions";
import { RefreshingActionForm } from "@/app/refreshing-action-form";
import { importBankTransactionAction, reconcilePaymentAction } from "./actions";

export const dynamic = "force-dynamic";

function money(currency: string, value: { toString(): string } | number) {
  const numeric = typeof value === "number" ? value : Number(value.toString());
  return `${currency}${numeric.toFixed(2)}`;
}

export default async function AccountingPaymentsPage() {
  const actor = await requirePermission("accounting:view");
  const canReconcile = hasPermission(actor, "invoice:markPaid");
  const { importedTransactions, approvedInvoices, receivedInvoices } = await getPaymentReconciliationDashboard();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Payment reconciliation</h1>
          <p className="max-w-3xl text-sm text-slate-600">
            Import bank/credit-card transaction evidence, then explicitly reconcile it to approved supplier invoices. Payment receipts remain evidence only until this human reconciliation step; reconciliation posts an AP payment journal.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/accounting/journals" className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">View journals</Link>
          <Link href="/accounting" className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Back to accounting</Link>
        </div>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-medium">Manual bank transaction import</h2>
        <p className="mt-1 text-xs text-slate-500">Importing rows is non-posting evidence. A journal is posted only after explicit allocation to an approved invoice.</p>
        {canReconcile ? (
          <RefreshingActionForm action={importBankTransactionAction} className="mt-3 grid gap-3 md:grid-cols-4">
            <input name="source" placeholder="Source / statement name" className="rounded-md border border-slate-300 px-2 py-1 text-sm" defaultValue="MANUAL_BANK_IMPORT" />
            <input name="postedAt" type="date" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
            <input name="reference" placeholder="Bank/payment reference" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
            <input name="amount" required placeholder="Amount, e.g. -145.50" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
            <input name="currency" placeholder="Currency" defaultValue="USD" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
            <input name="accountName" placeholder="Account" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
            <input name="counterparty" placeholder="Counterparty" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
            <input name="description" required placeholder="Statement description" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
            <button className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-white md:col-span-4">Import transaction</button>
          </RefreshingActionForm>
        ) : (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Your role can view accounting but cannot import or reconcile payments.</p>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="font-medium">Imported unmatched transactions</h2>
            <p className="text-xs text-slate-500">Deduped by source hash. Only approved invoices are selectable, because received invoices must be approved before payment.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {importedTransactions.length === 0 ? <p className="px-4 py-6 text-sm text-slate-500">No unmatched bank transactions.</p> : importedTransactions.map((transaction) => (
              <div key={transaction.id} className="space-y-3 px-4 py-4">
                <div>
                  <div className="font-medium">{transaction.reference ?? transaction.sourceHash.slice(0, 12)}</div>
                  <div className="text-sm text-slate-600">{transaction.postedAt.toISOString().slice(0, 10)} · {money(transaction.currency, transaction.amount)} · {transaction.description}</div>
                </div>
                {canReconcile && approvedInvoices.length > 0 ? (
                  <RefreshingActionForm action={reconcilePaymentAction} className="grid gap-2 md:grid-cols-[1fr_auto]">
                    <input type="hidden" name="bankTransactionId" value={transaction.id} />
                    <select name="supplierInvoiceId" required className="rounded-md border border-slate-300 px-2 py-1 text-sm">
                      <option value="">Choose approved invoice…</option>
                      {approvedInvoices.map((invoice) => (
                        <option key={invoice.id} value={invoice.id}>{invoice.supplier.name} · {invoice.invoiceNumber} · approved · {money(invoice.currency, invoice.total)}</option>
                      ))}
                    </select>
                    <button className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50">Reconcile</button>
                  </RefreshingActionForm>
                ) : (
                  <p className="text-xs text-slate-500">{canReconcile ? "Approve an invoice before reconciling this transaction." : "View-only: reconciliation controls hidden."}</p>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="font-medium">Approved invoices ready for payment</h2>
            <p className="text-xs text-slate-500">Manual allocation also posts a balanced AP payment journal. Configure ACCOUNTS_PAYABLE and BANK_CASH mappings first.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {approvedInvoices.length === 0 ? <p className="px-4 py-6 text-sm text-slate-500">No approved invoices open for payment.</p> : approvedInvoices.map((invoice) => {
              const allocated = invoice.paymentAllocations.reduce((total, allocation) => total + Number(allocation.amount.toString()), 0);
              return (
                <div key={invoice.id} className="px-4 py-4">
                  <div className="font-medium">{invoice.invoiceNumber}</div>
                  <div className="text-sm text-slate-600">{invoice.supplier.name} · total {money(invoice.currency, invoice.total)} · allocated {money(invoice.currency, allocated)}</div>
                  {canReconcile ? (
                    <RefreshingActionForm action={reconcilePaymentAction} className="mt-2 grid gap-2 md:grid-cols-3">
                      <input type="hidden" name="supplierInvoiceId" value={invoice.id} />
                      <input name="amount" placeholder="Manual amount" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
                      <input name="reference" required placeholder="Manual payment reference" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
                      <button className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50">Manual allocation</button>
                    </RefreshingActionForm>
                  ) : <p className="mt-2 text-xs text-slate-500">View-only: payment allocation controls hidden.</p>}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="font-medium">Received invoices waiting for approval</h2>
          <p className="text-xs text-slate-500">These are intentionally not reconcilable yet. Approve them first so AP invoice journals are posted before payment journals.</p>
        </div>
        <div className="divide-y divide-slate-100">
          {receivedInvoices.length === 0 ? <p className="px-4 py-6 text-sm text-slate-500">No received invoices waiting for approval.</p> : receivedInvoices.map((invoice) => (
            <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div><span className="font-medium">{invoice.invoiceNumber}</span> · {invoice.supplier.name} · {money(invoice.currency, invoice.total)}</div>
              <Link href="/accounting/invoices" className="rounded-md border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50">Approve on invoice ledger</Link>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
