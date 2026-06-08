import { InvoiceStatus } from "@prisma/client";
import { getInvoiceDashboard } from "@/modules/accounting/invoices";
import { RefreshingActionForm } from "@/app/refreshing-action-form";
import { requirePermission } from "@/modules/auth/permissions";
import { createInvoiceFromPurchaseOrderAction, updateInvoiceStatusAction } from "./actions";

export const dynamic = "force-dynamic";

function money(currency: string, value: { toString(): string } | number | null | undefined) {
  if (value == null) return `${currency}0.00`;
  const numeric = typeof value === "number" ? value : Number(value.toString());
  return `${currency}${numeric.toFixed(2)}`;
}

export default async function InvoicesPage() {
  await requirePermission("accounting:view");
  const { invoices, uninvoicedPurchaseOrders, totalsByStatus } = await getInvoiceDashboard();
  const payableTotal = totalsByStatus.RECEIVED?.toString() ?? "0";
  const approvedTotal = totalsByStatus.APPROVED?.toString() ?? "0";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Accounting invoices</h1>
        <p className="text-sm text-slate-600">
          Track supplier invoices from incoming purchase orders. This section is for accounting/AP status; it does not receive stock.
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Invoices</div>
          <div className="mt-1 text-2xl font-semibold">{invoices.length}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Received / unpaid</div>
          <div className="mt-1 text-2xl font-semibold">USD{Number(payableTotal ?? 0).toFixed(2)}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Approved for payment</div>
          <div className="mt-1 text-2xl font-semibold">USD{Number(approvedTotal ?? 0).toFixed(2)}</div>
        </div>
      </section>

      <section className="rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="font-medium">Purchase orders ready for invoice record</h2>
          <p className="text-xs text-slate-500">Creates accounting invoice records from incoming POs/order emails. Receiving stock remains separate.</p>
        </div>
        <div className="divide-y divide-slate-100">
          {uninvoicedPurchaseOrders.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">No uninvoiced incoming purchase orders.</p>
          ) : (
            uninvoicedPurchaseOrders.map((order) => {
              const subtotal = order.lines.reduce((total, line) => total + Number(line.unitPrice.toString()) * line.quantity, 0);
              const importRecord = order.emailOrderImports[0];
              return (
                <div key={order.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[1fr_auto] lg:items-center">
                  <div>
                    <div className="font-medium">PO {order.id}</div>
                    <div className="text-sm text-slate-600">
                      {order.supplier.name} · {order.status} · {order.lines.length} line(s) · subtotal {money(importRecord?.currency ?? "USD", importRecord?.subtotal ?? subtotal)}
                      {importRecord?.externalOrderId ? ` · order ${importRecord.externalOrderId}` : ""}
                    </div>
                  </div>
                  <RefreshingActionForm action={createInvoiceFromPurchaseOrderAction}>
                    <input type="hidden" name="purchaseOrderId" value={order.id} />
                    <button className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-white">Create invoice</button>
                  </RefreshingActionForm>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="font-medium">Supplier invoices</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">PO</th>
                <th className="px-4 py-3">Source document</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.length === 0 ? (
                <tr><td className="px-4 py-6 text-slate-500" colSpan={7}>No supplier invoices yet.</td></tr>
              ) : (
                invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="px-4 py-3 font-medium">{invoice.invoiceNumber}</td>
                    <td className="px-4 py-3">{invoice.supplier.name}</td>
                    <td className="px-4 py-3">{invoice.status}</td>
                    <td className="px-4 py-3">{money(invoice.currency, invoice.total)}</td>
                    <td className="px-4 py-3">{invoice.purchaseOrderId ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {invoice.sourceDocumentPath ?? invoice.externalSourceUrl ?? "—"}
                      {invoice.sourceDocumentHash ? <div className="text-slate-400">SHA256 {invoice.sourceDocumentHash.slice(0, 12)}…</div> : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {invoice.status === InvoiceStatus.RECEIVED ? (
                          <RefreshingActionForm action={updateInvoiceStatusAction}>
                            <input type="hidden" name="invoiceId" value={invoice.id} />
                            <input type="hidden" name="status" value={InvoiceStatus.APPROVED} />
                            <button className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50">Approve</button>
                          </RefreshingActionForm>
                        ) : null}
                        {invoice.status === InvoiceStatus.APPROVED ? (
                          <RefreshingActionForm action={updateInvoiceStatusAction}>
                            <input type="hidden" name="invoiceId" value={invoice.id} />
                            <input type="hidden" name="status" value={InvoiceStatus.PAID} />
                            <input
                              className="w-36 rounded-md border border-slate-300 px-2 py-1 text-xs"
                              name="paymentReference"
                              placeholder="Payment ref"
                              required
                            />
                            <button className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50">Mark paid</button>
                          </RefreshingActionForm>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
