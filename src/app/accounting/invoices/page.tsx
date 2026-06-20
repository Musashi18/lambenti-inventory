import Link from "next/link";
import { InvoiceStatus } from "@prisma/client";
import { getInvoiceDashboard, summarizeInvoiceDuplicateClusters, summarizeInvoiceWorkQueue, type InvoiceDuplicateCluster, type InvoiceWorkQueueRow } from "@/modules/accounting/invoices";
import { RefreshingActionForm } from "@/app/refreshing-action-form";
import { hasPermission, requirePermission } from "@/modules/auth/permissions";
import { createInvoiceFromPurchaseOrderAction, updateInvoiceStatusAction, updateInvoiceTermsAction, voidDuplicateInvoiceClusterAction } from "./actions";

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

function statusBadgeClass(status: string) {
  if (status === InvoiceStatus.RECEIVED) return "border-blue-200 bg-blue-50 text-blue-800";
  if (status === InvoiceStatus.APPROVED) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === InvoiceStatus.PAID) return "border-slate-200 bg-slate-50 text-slate-700";
  if (status === InvoiceStatus.VOID) return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-slate-200 bg-white text-slate-700";
}

function readinessClass(row: InvoiceWorkQueueRow) {
  if (row.warnings.length > 0) return "border-amber-200 bg-amber-50 text-amber-800";
  if (row.status === InvoiceStatus.RECEIVED) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (row.status === InvoiceStatus.APPROVED) return "border-blue-200 bg-blue-50 text-blue-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function readinessLabel(row: InvoiceWorkQueueRow) {
  if (row.warnings.length > 0) return row.warnings.join(" · ");
  return row.nextAction;
}

function evidenceText(row: InvoiceWorkQueueRow) {
  if (!row.evidenceReady) return "no source evidence";
  if (row.evidenceCount > 0) return `${row.evidenceCount} evidence document(s)`;
  return "primary source evidence saved";
}

function QueueRow({ row, canApproveInvoices, canEditTerms }: { row: InvoiceWorkQueueRow; canApproveInvoices: boolean; canEditTerms: boolean }) {
  const approvalBlocked = row.warnings.length > 0;
  return (
    <li className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-medium text-slate-900">{row.supplierName} · {row.invoiceNumber}</div>
          <div className="mt-1 text-xs text-slate-500">{row.status} · {evidenceText(row)} · {row.dueLabel}</div>
          {approvalBlocked ? <div className="mt-1 text-xs text-amber-700">Resolve blockers before approval: {row.warnings.join(" · ")}</div> : null}
          {canEditTerms && row.dueDate == null && (row.status === InvoiceStatus.RECEIVED || row.status === InvoiceStatus.APPROVED) ? (
            <RefreshingActionForm action={updateInvoiceTermsAction} className="mt-2 flex flex-wrap gap-1">
              <input type="hidden" name="invoiceId" value={row.id} />
              <input name="dueDate" type="date" required className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
              <button className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">Set Due Date</button>
            </RefreshingActionForm>
          ) : null}
        </div>
        <div className="text-right">
          <div className="font-semibold">{money(row.currency, row.openBalance)}</div>
          <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${readinessClass(row)}`}>{readinessLabel(row)}</span>
          {canApproveInvoices && row.status === InvoiceStatus.RECEIVED && !approvalBlocked ? (
            <RefreshingActionForm action={updateInvoiceStatusAction} className="mt-2">
              <input type="hidden" name="invoiceId" value={row.id} />
              <input type="hidden" name="status" value={InvoiceStatus.APPROVED} />
              <button className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">Approve from Queue</button>
            </RefreshingActionForm>
          ) : canApproveInvoices && row.status === InvoiceStatus.RECEIVED ? (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">Approval blocked</div>
          ) : row.status === InvoiceStatus.APPROVED ? (
            <Link href="/accounting/payments" className="mt-2 inline-flex rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">Reconcile Payment</Link>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function DuplicateInvoiceGuardrail({ clusters, canApproveInvoices }: { clusters: InvoiceDuplicateCluster[]; canApproveInvoices: boolean }) {
  if (clusters.length === 0) {
    return (
      <section className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <div className="font-medium">Duplicate Invoice Guardrail clear</div>
        <p className="mt-1 text-xs">No open supplier invoices share the same supplier, PO, status, currency, and total.</p>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-950">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Duplicate Invoice Guardrail</h2>
          <p className="mt-1 text-xs">
            {clusters.length} duplicate cluster{clusters.length === 1 ? "" : "s"} need review before approval/payment. Auto-void only touches DRAFT/RECEIVED duplicates without evidence, journals, or payments; stock receiving remains separate.
          </p>
        </div>
        <div className="rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-rose-800">
          Amount at risk {money("USD", clusters.reduce((total, cluster) => total + cluster.amountAtRisk, 0))}
        </div>
      </div>
      <div className="mt-3 space-y-3">
        {clusters.map((cluster) => (
          <article key={cluster.key} className="rounded-md border border-rose-200 bg-white p-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="font-medium text-slate-900">{cluster.supplierName} · {cluster.invoiceCount} matching invoices</div>
                <div className="mt-1 text-xs text-slate-600">
                  {cluster.status} · {cluster.currency} {cluster.total.toFixed(2)} each · duplicate exposure {cluster.currency} {cluster.amountAtRisk.toFixed(2)} · PO {cluster.purchaseOrderId?.slice(-8).toUpperCase() ?? "unlinked"}
                </div>
                <div className="mt-2 text-xs text-slate-500">Invoices: {cluster.invoiceNumbers.join(", ")}</div>
                <div className="mt-1 text-xs text-slate-500">Keeping invoice id {cluster.canonicalInvoiceId.slice(-8).toUpperCase()} by evidence/oldest-record priority.</div>
                {!cluster.canVoidDuplicates ? <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">{cluster.blockReason}</div> : null}
              </div>
              {canApproveInvoices && cluster.canVoidDuplicates ? (
                <RefreshingActionForm
                  action={voidDuplicateInvoiceClusterAction}
                  className="min-w-64 space-y-2"
                  confirmMessage={`Void ${cluster.duplicateCount} duplicate invoice(s) and keep ${cluster.canonicalInvoiceId}? This will not receive stock or mark anything paid.`}
                >
                  <input type="hidden" name="clusterKey" value={cluster.key} />
                  <input type="hidden" name="keepInvoiceId" value={cluster.canonicalInvoiceId} />
                  <input type="hidden" name="voidReason" value={`Duplicate invoice cluster reviewed from invoice guardrail; kept ${cluster.canonicalInvoiceId}.`} />
                  <button className="w-full rounded-md bg-rose-700 px-3 py-2 text-xs font-medium text-white hover:bg-rose-800">Void Duplicate Copies</button>
                </RefreshingActionForm>
              ) : (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">Manual review required</div>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default async function InvoicesPage() {
  const actor = await requirePermission("accounting:view");
  const canCreateInvoices = hasPermission(actor, "invoice:create");
  const canApproveInvoices = hasPermission(actor, "invoice:approve");
  const canMarkPaid = hasPermission(actor, "invoice:markPaid");
  const { invoices, uninvoicedPurchaseOrders, totalsByStatus } = await getInvoiceDashboard();
  const payableTotal = totalsByStatus.RECEIVED?.toString() ?? "0";
  const approvedTotal = totalsByStatus.APPROVED?.toString() ?? "0";
  const workQueue = summarizeInvoiceWorkQueue(invoices);
  const duplicateClusters = summarizeInvoiceDuplicateClusters(invoices);
  const workRowsByInvoiceId = new Map(workQueue.rows.map((row) => [row.id, row]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Accounting Invoices</h1>
          <p className="text-sm text-slate-600">
            Track supplier invoices from incoming purchase orders. Approval posts a balanced AP journal; payment allocation posts a payment journal. This section does not receive stock.
          </p>
        </div>
        <Link href="/accounting/journals" className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">View Posted Journals</Link>
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

      <DuplicateInvoiceGuardrail clusters={duplicateClusters} canApproveInvoices={canApproveInvoices} />

      <section className="rounded-md border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-medium">Invoice Approval Workbench</h2>
            <p className="text-xs text-slate-500">A small-business bill-review pattern: see what is open, what is ready to approve, what is missing evidence/due dates, and what is waiting for payment before scanning the full ledger.</p>
          </div>
          <div className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600">Open AP {money("USD", workQueue.openTotal)}</div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-5">
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-blue-900">
            <div className="text-xs uppercase tracking-wide">Received</div>
            <div className="mt-1 text-2xl font-semibold">{workQueue.receivedCount}</div>
            <div className="text-xs">awaiting approval</div>
          </div>
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
            <div className="text-xs uppercase tracking-wide">Ready to Approve</div>
            <div className="mt-1 text-2xl font-semibold">{workQueue.approvalReadyCount}</div>
            <div className="text-xs">evidence + terms clear</div>
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
            <div className="text-xs uppercase tracking-wide">Blocked before approval</div>
            <div className="mt-1 text-2xl font-semibold">{workQueue.approvalBlockedCount}</div>
            <div className="text-xs">Needs evidence or due date first</div>
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
            <div className="text-xs uppercase tracking-wide">Missing due date</div>
            <div className="mt-1 text-2xl font-semibold">{workQueue.missingDueDateCount}</div>
            <div className="text-xs">set terms when known</div>
          </div>
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-blue-900">
            <div className="text-xs uppercase tracking-wide">Payment Queue</div>
            <div className="mt-1 text-2xl font-semibold">{workQueue.approvedAwaitingPaymentCount}</div>
            <div className="text-xs">approved invoices</div>
          </div>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div>
            <h3 className="text-sm font-medium">Ready to Approve</h3>
            <p className="mt-1 text-xs text-slate-500">Only rows with source evidence and due-date terms show the approval action.</p>
            {workQueue.approvalReadyQueue.length === 0 ? <p className="mt-2 text-sm text-slate-500">No invoices are fully ready for approval.</p> : (
              <ol className="mt-2 space-y-2">
                {workQueue.approvalReadyQueue.map((row) => <QueueRow key={row.id} row={row} canApproveInvoices={canApproveInvoices} canEditTerms={canCreateInvoices} />)}
              </ol>
            )}
          </div>
          <div>
            <h3 className="text-sm font-medium">Fix Before Approval</h3>
            <p className="mt-1 text-xs text-slate-500">Blocked rows stay visible with due-date repair controls, but no approve button.</p>
            {workQueue.approvalBlockedQueue.length === 0 ? <p className="mt-2 text-sm text-slate-500">No received invoices are blocked.</p> : (
              <ol className="mt-2 space-y-2">
                {workQueue.approvalBlockedQueue.map((row) => <QueueRow key={row.id} row={row} canApproveInvoices={canApproveInvoices} canEditTerms={canCreateInvoices} />)}
              </ol>
            )}
          </div>
          <div>
            <h3 className="text-sm font-medium">Payment Queue</h3>
            {workQueue.paymentQueue.length === 0 ? <p className="mt-2 text-sm text-slate-500">No approved invoices waiting for payment reconciliation.</p> : (
              <ol className="mt-2 space-y-2">
                {workQueue.paymentQueue.map((row) => <QueueRow key={row.id} row={row} canApproveInvoices={canApproveInvoices} canEditTerms={canCreateInvoices} />)}
              </ol>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="font-medium">Purchase Orders Ready for Invoice Record</h2>
          <p className="text-xs text-slate-500">Creates accounting invoice records from incoming POs/order emails. Receiving stock remains separate.</p>
        </div>
        <div className="divide-y divide-slate-100">
          {uninvoicedPurchaseOrders.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">No uninvoiced incoming purchase orders.</p>
          ) : (
            uninvoicedPurchaseOrders.map((order) => {
              const subtotal = order.lines.reduce((total, line) => total + Number(line.unitPrice.toString()) * line.quantity, 0);
              const importRecord = order.emailOrderImports[0];
              const activeInvoices = order.invoices.filter((invoice) => invoice.status !== InvoiceStatus.VOID);
              const voidedInvoiceCount = order.invoices.length - activeInvoices.length;
              return (
                <div key={order.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[1fr_auto] lg:items-center">
                  <div>
                    <div className="font-medium">PO {order.id}</div>
                    <div className="text-sm text-slate-600">
                      {order.supplier.name} · {order.status} · {order.lines.length} line(s) · subtotal {money(importRecord?.currency ?? "USD", importRecord?.subtotal ?? subtotal)}
                      {importRecord?.externalOrderId ? ` · order ${importRecord.externalOrderId}` : ""}
                    </div>
                    <div className="text-xs text-slate-500">
                      Active invoices: {activeInvoices.length} · active invoiced total USD{activeInvoices.reduce((sum, invoice) => sum + Number(invoice.total.toString()), 0).toFixed(2)}
                      {voidedInvoiceCount > 0 ? ` · voided duplicates ${voidedInvoiceCount}` : ""}
                    </div>
                  </div>
                  {canCreateInvoices ? (
                    <RefreshingActionForm action={createInvoiceFromPurchaseOrderAction} className="grid gap-2 sm:grid-cols-2 lg:w-[32rem]">
                      <input type="hidden" name="purchaseOrderId" value={order.id} />
                      <input name="invoiceNumber" placeholder="Invoice # for deposit/final" className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
                      <input name="subtotal" placeholder="Optional subtotal" className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
                      <input name="taxCost" placeholder="Optional tax" className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
                      <input name="total" placeholder="Optional total" className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
                      <input name="notes" placeholder="Review notes" className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
                      <button className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-white sm:col-span-2">Create Invoice Record</button>
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
          <h2 className="font-medium">Supplier Invoices</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">PO</th>
                <th className="px-4 py-3">Source Document</th>
                <th className="px-4 py-3">Review Readiness</th>
                <th className="px-4 py-3">Journals</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.length === 0 ? (
                <tr><td className="px-4 py-6 text-slate-500" colSpan={10}>No supplier invoices yet.</td></tr>
              ) : (
                invoices.map((invoice) => {
                  const workRow = workRowsByInvoiceId.get(invoice.id);
                  return (
                  <tr key={invoice.id}>
                    <td className="px-4 py-3 font-medium">{invoice.invoiceNumber}</td>
                    <td className="px-4 py-3">{invoice.supplier.name}</td>
                    <td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(invoice.status)}`}>{invoice.status}</span></td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <div>{workRow?.dueLabel ?? (invoice.dueDate ? invoice.dueDate.toISOString().slice(0, 10) : "No due date")}</div>
                      {canCreateInvoices && (invoice.status === InvoiceStatus.RECEIVED || invoice.status === InvoiceStatus.APPROVED) ? (
                        <RefreshingActionForm action={updateInvoiceTermsAction} className="mt-2 flex flex-wrap gap-1">
                          <input type="hidden" name="invoiceId" value={invoice.id} />
                          <input name="dueDate" type="date" defaultValue={invoice.dueDate ? invoice.dueDate.toISOString().slice(0, 10) : ""} required className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
                          <button className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">Save Due Date</button>
                        </RefreshingActionForm>
                      ) : null}
                    </td>
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
                      {workRow ? (
                        <div>
                          <span className={`inline-flex rounded-full border px-2 py-0.5 font-medium ${readinessClass(workRow)}`}>{readinessLabel(workRow)}</span>
                          <div className="mt-1 text-slate-500">Open {money(workRow.currency, workRow.openBalance)} · {workRow.journalCount} journal(s)</div>
                        </div>
                      ) : (
                        <span className="text-slate-500">Closed / no action</span>
                      )}
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
                      <Link href="/accounting/journals" className="mt-1 inline-block text-blue-700 hover:underline">Open Journals</Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {canApproveInvoices && invoice.status === InvoiceStatus.RECEIVED && (!workRow || workRow.warnings.length === 0) ? (
                          <RefreshingActionForm action={updateInvoiceStatusAction}>
                            <input type="hidden" name="invoiceId" value={invoice.id} />
                            <input type="hidden" name="status" value={InvoiceStatus.APPROVED} />
                            <button className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50">Approve & Post Journal</button>
                          </RefreshingActionForm>
                        ) : canApproveInvoices && invoice.status === InvoiceStatus.RECEIVED ? (
                          <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">Resolve approval blockers first</div>
                        ) : null}
                        {canMarkPaid && invoice.status === InvoiceStatus.APPROVED ? (
                          <RefreshingActionForm action={updateInvoiceStatusAction}>
                            <input type="hidden" name="invoiceId" value={invoice.id} />
                            <input type="hidden" name="status" value={InvoiceStatus.PAID} />
                            <input
                              className="w-36 rounded-md border border-slate-300 px-2 py-1 text-xs"
                              name="paymentReference"
                              placeholder="Payment Ref"
                              required
                            />
                            <button className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50">Allocate & Mark Paid</button>
                          </RefreshingActionForm>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
