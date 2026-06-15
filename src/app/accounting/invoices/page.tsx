import Link from "next/link";
import { InvoiceStatus } from "@prisma/client";
import { getInvoiceDashboard } from "@/modules/accounting/invoices";
import { RefreshingActionForm } from "@/app/refreshing-action-form";
import { hasPermission, requirePermission } from "@/modules/auth/permissions";
import { createInvoiceFromPurchaseOrderAction, updateInvoiceStatusAction } from "./actions";

export const dynamic = "force-dynamic";

function money(currency: string, value: { toString(): string } | number | null | undefined) {
  if (value == null) return `${currency}0.00`;
  const numeric = typeof value === "number" ? value : Number(value.toString());
  return `${currency}${numeric.toFixed(2)}`;
}

function evidenceClassification(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Unclassified";
  const candidate = value as { classification?: unknown };
  return typeof candidate.classification === "string" ? candidate.classification : "Unclassified";
}

export default async function InvoicesPage() {
  const actor = await requirePermission("accounting:view");
  const canCreateInvoices = hasPermission(actor, "invoice:create");
  const canApproveInvoices = hasPermission(actor, "invoice:approve");
  const canMarkPaid = hasPermission(actor, "invoice:markPaid");
  const { invoices, uninvoicedPurchaseOrders, totalsByStatus } = await getInvoiceDashboard();
  const payableTotal = totalsByStatus.RECEIVED?.toString() ?? "0";
  const approvedTotal = totalsByStatus.APPROVED?.toString() ?? "0";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Accounting invoices</h1>
          <p className="text-sm text-slate-600">
            Track supplier invoices from incoming purchase orders. Approval posts a balanced AP journal; payment allocation posts a payment journal. This section does not receive stock.
          </p>
        </div>
        <Link href="/accounting/journals" className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">View posted journals</Link>
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
                    <div className="text-xs text-slate-500">Existing invoices: {order.invoices.length} · invoiced total USD{order.invoices.reduce((sum, invoice) => sum + Number(invoice.total.toString()), 0).toFixed(2)}</div>
                  </div>
                  {canCreateInvoices ? (
                    <RefreshingActionForm action={createInvoiceFromPurchaseOrderAction} className="grid gap-2 sm:grid-cols-2 lg:w-[32rem]">
                      <input type="hidden" name="purchaseOrderId" value={order.id} />
                      <input name="invoiceNumber" placeholder="Invoice # for deposit/final" className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
                      <input name="subtotal" placeholder="Optional subtotal" className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
                      <input name="taxCost" placeholder="Optional tax" className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
                      <input name="total" placeholder="Optional total" className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
                      <input name="notes" placeholder="Review notes" className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
                      <button className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-white sm:col-span-2">Create invoice record</button>
                    </RefreshingActionForm>
                  ) : <p className="text-xs text-slate-500">View-only: invoice creation controls hidden.</p>}
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
                <th className="px-4 py-3">Journals</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.length === 0 ? (
                <tr><td className="px-4 py-6 text-slate-500" colSpan={8}>No supplier invoices yet.</td></tr>
              ) : (
                invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="px-4 py-3 font-medium">{invoice.invoiceNumber}</td>
                    <td className="px-4 py-3">{invoice.supplier.name}</td>
                    <td className="px-4 py-3">{invoice.status}</td>
                    <td className="px-4 py-3">{money(invoice.currency, invoice.total)}
                      {invoice.paymentAllocations.length > 0 ? <div className="text-xs text-slate-500">paid/reconciled {money(invoice.currency, invoice.paymentAllocations.reduce((sum, allocation) => sum + Number(allocation.amount.toString()), 0))}</div> : null}
                    </td>
                    <td className="px-4 py-3">{invoice.purchaseOrderId ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <div className="font-medium text-slate-700">Evidence bundle · {invoice.accountingDocuments.length} document(s)</div>
                      {invoice.sourceDocumentPath ?? invoice.externalSourceUrl ? (
                        <div className="mt-1 truncate">Primary: {invoice.sourceDocumentPath ?? invoice.externalSourceUrl}</div>
                      ) : null}
                      {invoice.sourceDocumentHash ? <div className="text-slate-400">SHA256 {invoice.sourceDocumentHash.slice(0, 12)}…</div> : null}
                      {invoice.accountingDocuments.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {invoice.accountingDocuments.slice(0, 3).map((document) => (
                            <li key={document.id} className="rounded border border-slate-100 bg-slate-50 p-2">
                              <div className="font-medium text-slate-700">{document.originalFileName}</div>
                              <div className="text-slate-500">{document.status} · {evidenceClassification(document.analysisJson)}</div>
                              <Link href={`/api/accounting/documents/${document.id}/download`} className="text-blue-700 hover:underline">Download</Link>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {invoice.journalEntries.length === 0 ? (
                        <div className="text-slate-500">Not posted yet</div>
                      ) : (
                        <ul className="space-y-1">
                          {invoice.journalEntries.slice(0, 3).map((entry) => (
                            <li key={entry.id} className="rounded border border-emerald-100 bg-emerald-50 px-2 py-1 text-emerald-800">
                              {entry.entryNumber} · {entry.kind} · {entry.status}
                            </li>
                          ))}
                        </ul>
                      )}
                      <Link href="/accounting/journals" className="mt-1 inline-block text-blue-700 hover:underline">Open journals</Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {canApproveInvoices && invoice.status === InvoiceStatus.RECEIVED ? (
                          <RefreshingActionForm action={updateInvoiceStatusAction}>
                            <input type="hidden" name="invoiceId" value={invoice.id} />
                            <input type="hidden" name="status" value={InvoiceStatus.APPROVED} />
                            <button className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50">Approve & post journal</button>
                          </RefreshingActionForm>
                        ) : null}
                        {canMarkPaid && invoice.status === InvoiceStatus.APPROVED ? (
                          <RefreshingActionForm action={updateInvoiceStatusAction}>
                            <input type="hidden" name="invoiceId" value={invoice.id} />
                            <input type="hidden" name="status" value={InvoiceStatus.PAID} />
                            <input
                              className="w-36 rounded-md border border-slate-300 px-2 py-1 text-xs"
                              name="paymentReference"
                              placeholder="Payment ref"
                              required
                            />
                            <button className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50">Allocate & mark paid</button>
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
