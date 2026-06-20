import Link from "next/link";
import { CustomerInvoiceStatus } from "@prisma/client";
import { RefreshingActionForm } from "@/app/refreshing-action-form";
import { getCustomerInvoiceDashboard } from "@/modules/accounting/customer-invoices";
import { requirePermission } from "@/modules/auth/permissions";
import { createCustomerInvoiceAction, updateCustomerInvoiceStatusAction } from "./actions";

export const dynamic = "force-dynamic";

function money(currency: string, value: { toString(): string } | number) {
  const numeric = typeof value === "number" ? value : Number(value.toString());
  return `${currency}${numeric.toFixed(2)}`;
}

export default async function CustomerInvoicesPage() {
  await requirePermission("accounting:view");
  const { invoices, openInvoices, totalsByStatus } = await getCustomerInvoiceDashboard();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Customer Invoices / AR</h1>
          <p className="max-w-3xl text-sm text-slate-600">
            Draft and track customer-facing invoices for Lambenti sales. AR invoices do not consume stock, reserve inventory, or ship products; fulfillment remains a separate human operations workflow.
          </p>
        </div>
        <Link href="/accounting" className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Back to Accounting</Link>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="Customer invoices" value={invoices.length.toString()} subtext="AR records" />
        <SummaryCard label="Open" value={openInvoices.length.toString()} subtext="Draft or sent" />
        <SummaryCard label="Sent" value={`CAD${Number(totalsByStatus.SENT?.toString() ?? 0).toFixed(2)}`} subtext="Awaiting payment" />
        <SummaryCard label="Paid" value={`CAD${Number(totalsByStatus.PAID?.toString() ?? 0).toFixed(2)}`} subtext="Payment Reference retained" />
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-medium">Create Customer Invoice</h2>
        <RefreshingActionForm action={createCustomerInvoiceAction} className="mt-3 grid gap-3 md:grid-cols-4">
          <input name="customerName" required placeholder="Customer name" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <input name="companyName" placeholder="Company/legal name" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <input name="contactEmail" placeholder="Customer email" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <input name="taxRegistrationNumber" placeholder="Customer tax #" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <input name="invoiceNumber" required placeholder="Invoice number" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <input name="currency" placeholder="Currency" defaultValue="CAD" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <input name="invoiceDate" type="date" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <input name="dueDate" type="date" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <input name="description" required placeholder="Line description" className="rounded-md border border-slate-300 px-2 py-1 text-sm md:col-span-2" />
          <input name="quantity" type="number" min="1" defaultValue="1" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <input name="unitPrice" required placeholder="Unit Price" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <input name="taxRate" placeholder="Tax rate, e.g. 0.13" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <input name="notes" placeholder="Notes" className="rounded-md border border-slate-300 px-2 py-1 text-sm md:col-span-3" />
          <button className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-white md:col-span-4">Create AR Invoice</button>
        </RefreshingActionForm>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3"><h2 className="font-medium">Customer Invoice Ledger</h2></div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.length === 0 ? <tr><td className="px-4 py-6 text-slate-500" colSpan={5}>No customer invoices yet.</td></tr> : invoices.map((invoice) => (
                <tr key={invoice.id} className="align-top">
                  <td className="px-4 py-3 font-medium">{invoice.invoiceNumber}<div className="text-xs text-slate-500">{invoice.invoiceDate.toISOString().slice(0, 10)}</div></td>
                  <td className="px-4 py-3">{invoice.customer.companyName ?? invoice.customer.name}</td>
                  <td className="px-4 py-3">{invoice.status}</td>
                  <td className="px-4 py-3">{money(invoice.currency, invoice.total)}<div className="text-xs text-slate-500">tax {money(invoice.currency, invoice.taxCost)}</div></td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {invoice.status === CustomerInvoiceStatus.DRAFT ? <StatusForm invoiceId={invoice.id} status={CustomerInvoiceStatus.SENT} label="Mark sent" /> : null}
                      {invoice.status === CustomerInvoiceStatus.SENT ? (
                        <RefreshingActionForm action={updateCustomerInvoiceStatusAction} className="flex gap-2">
                          <input type="hidden" name="customerInvoiceId" value={invoice.id} />
                          <input type="hidden" name="status" value={CustomerInvoiceStatus.PAID} />
                          <input name="paymentReference" required placeholder="Payment Ref" className="w-36 rounded-md border border-slate-300 px-2 py-1 text-xs" />
                          <button className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50">Mark Paid</button>
                        </RefreshingActionForm>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StatusForm({ invoiceId, status, label }: { invoiceId: string; status: CustomerInvoiceStatus; label: string }) {
  return (
    <RefreshingActionForm action={updateCustomerInvoiceStatusAction}>
      <input type="hidden" name="customerInvoiceId" value={invoiceId} />
      <input type="hidden" name="status" value={status} />
      <button className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50">{label}</button>
    </RefreshingActionForm>
  );
}

function SummaryCard({ label, value, subtext }: { label: string; value: string; subtext: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{subtext}</div>
    </div>
  );
}
