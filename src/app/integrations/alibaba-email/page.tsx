import { prisma } from "@/lib/prisma";
import { getEmailOrderImports } from "@/modules/email-imports/alibaba-email";
import { getAlibabaMailboxConfigStatus } from "@/modules/email-imports/mailbox";
import { RefreshingActionForm } from "@/app/refreshing-action-form";
import { requirePermission } from "@/modules/auth/permissions";
import {
  applyAlibabaEmailImportAction,
  archiveAlibabaEmailImportAction,
  deleteArchivedAlibabaEmailImportAction,
  importAlibabaEmailAction,
  reassessRecentAlibabaEmailImportsAction,
  syncAlibabaEmailMailboxAction,
  unarchiveAlibabaEmailImportAction,
  updateAlibabaEmailLineAction
} from "./actions";
import { MailboxSyncButton, ReassessRecentImportsButton } from "./mailbox-sync-button";

export const dynamic = "force-dynamic";

export default async function EmailImportPage({
  searchParams
}: {
  searchParams?: Promise<{ archived?: string }>;
}) {
  await requirePermission("integration:mutate");
  const params = await searchParams;
  const showArchived = params?.archived === "1";
  const [imports, itemOptions] = await Promise.all([
    getEmailOrderImports({ archivedOnly: showArchived }),
    prisma.item.findMany({
      where: { lifecycleStatus: { not: "OBSOLETE" } },
      orderBy: { sku: "asc" },
      select: { id: true, sku: true, description: true }
    })
  ]);
  const mailbox = getAlibabaMailboxConfigStatus();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Order Email Agent</h1>
        <p className="text-sm text-slate-600">
          The agent scans supplier order/invoice/payment/shipping emails, extracts one or more line items per email, links confident matches into incoming purchase orders and accounting invoice records, and never receives stock. Uncertain lines can be edited and manually matched before applying.
        </p>
      </div>

      <section className="rounded-md border border-slate-200 bg-white p-4">
        <h2 className="font-medium">Direct Alibaba portal agent</h2>
        <p className="mt-1 text-sm text-slate-600">
          The scheduled agent opens a saved Google Chrome session, can submit Chrome-saved/autofilled login fields on a normal Alibaba login form, reads Alibaba order/message pages, downloads invoice/receipt files,
          detects CAPTCHA/security checks for manual completion instead of bypassing them, extracts invoice text, then posts portal snapshots to the local import API.
        </p>
        <div className="mt-3 grid gap-2 text-xs text-slate-600 md:grid-cols-2">
          <div className="rounded-md bg-slate-50 p-3">
            <div className="font-medium text-slate-700">One-time login</div>
            <code className="mt-1 block break-all">npm run agent:alibaba-login</code>
            <p className="mt-1">Sign into Alibaba in the opened Chrome window; the agent reuses that local Chrome profile later. CAPTCHA/security checks are manual-only.</p>
          </div>
          <div className="rounded-md bg-slate-50 p-3">
            <div className="font-medium text-slate-700">Manual run</div>
            <code className="mt-1 block break-all">npm run agent:alibaba</code>
            <p className="mt-1">Reads the portal first, downloads invoices into <code>var/alibaba-invoices</code>, then checks the configured supplier-order mailbox. Run it manually when you want to update tracking.</p>
          </div>
        </div>
      </section>

      <section className="rounded-md border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="font-medium">Supplier order mailbox connection</h2>
            <p className="mt-1 text-sm text-slate-600">
              {mailbox.configured
                ? `Configured for ${mailbox.user} on ${mailbox.host}, folder ${mailbox.mailbox}. Auto-apply is ${mailbox.autoApply ? "on" : "off"}; auto-invoices are ${mailbox.autoCreateInvoice ? "on" : "off"}.`
                : `Not connected yet. Missing: ${mailbox.missing.join(", ")}.`}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Sync searches recent supplier order/invoice/payment/shipping messages, including forwarded .eml/text attachments. It imports each message once by content hash, saves tracking numbers found in shipment notifications without receiving stock, and when a shipment confirmation includes an Alibaba order-detail link it launches targeted tracking-only Alibaba capture for that exact order before refreshing the tracking list.
            </p>
            {mailbox.retry.status !== "idle" ? (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Mailbox retry status: {mailbox.retry.status}
                {mailbox.retry.nextRetryAt ? ` · next retry ${new Date(mailbox.retry.nextRetryAt).toLocaleTimeString()}` : ""}
                {mailbox.retry.status === "exhausted" ? " · queued for manual retry" : ""}
              </div>
            ) : null}
          </div>
          <MailboxSyncButton syncAction={syncAlibabaEmailMailboxAction} disabled={!mailbox.configured} />
        </div>
      </section>

      <section className="rounded-md border border-slate-200 bg-white">
        <details>
          <summary className="cursor-pointer list-none px-4 py-3 font-medium">
            Import a supplier order email manually
            <span className="ml-2 text-xs font-normal text-slate-500">Collapsed by default</span>
          </summary>
          <div className="border-t border-slate-100 p-4">
            <RefreshingActionForm action={importAlibabaEmailAction} className="space-y-3">
              <textarea
                name="rawText"
                required
                rows={12}
                className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
                placeholder={`Paste the full email text here. Multi-line and CSV-style rows are supported:\nSKU, Description, Quantity, Unit price, Total\nLMB-LED-001, LED strip, 10, 2.50, 25.00\nLMB-PSU-001, Power adapter, 5, 3.20, 16.00`}
              />
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input name="autoApply" type="checkbox" defaultChecked className="mt-1" />
                <span>
                  Automatically apply matched lines: update item cost/provenance, create an ORDERED purchase order, and create a RECEIVED supplier invoice. Unmatched or manually edited unmatched lines stay in review.
                </span>
              </label>
              <button className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white">Import email</button>
            </RefreshingActionForm>
          </div>
        </details>
      </section>

      <section className="rounded-md border border-slate-200 bg-white">
        <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-medium">{showArchived ? "Archived imported order emails" : "Recent imported order emails"}</h2>
            <p className="text-xs text-slate-500">
              {showArchived ? "Archived messages are hidden from the active review queue but kept for audit and later reference." : "Use Ignore & archive to hide messages that are not actionable. Reassess checks the mailbox/OCR pipeline, reparses stored supplier emails, and updates richer line-item/order metadata without receiving stock."}
            </p>
          </div>
          <div className="flex flex-wrap gap-3 md:items-center md:justify-end">
            {!showArchived ? <ReassessRecentImportsButton reassessAction={reassessRecentAlibabaEmailImportsAction} /> : null}
            <a
              href={showArchived ? "/integrations/email-import" : "/integrations/email-import?archived=1"}
              className="text-sm font-medium text-ink underline underline-offset-4"
            >
              {showArchived ? "Back to active messages" : "View archived messages"}
            </a>
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          {imports.length === 0 ? (
            <div className="p-4 text-sm text-slate-500">No order email imports yet.</div>
          ) : (
            imports.map((imported) => (
              <div key={imported.id} className="space-y-3 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="font-medium">
                      {imported.externalOrderId ? `Order ${imported.externalOrderId}` : imported.subject ?? "Order email import"}
                    </div>
                    <div className="text-sm text-slate-600">
                      Supplier: {imported.supplier?.name ?? imported.supplierName} · Source: {displayEmailImportSource(imported.source)} · Status: {imported.status} · Confidence: {imported.confidence} · Lines: {imported.lines.length}
                    </div>
                    <div className="text-sm text-slate-600">
                      Subtotal: {imported.currency} {imported.subtotal?.toString() ?? "unknown"} · Shipping: {imported.currency} {imported.shippingCost?.toString() ?? "0"} · Tax/duty: {imported.currency} {imported.taxCost?.toString() ?? "0"} · Total: {imported.currency} {imported.totalCost?.toString() ?? "unknown"}
                      {imported.purchaseOrder ? ` · PO ${imported.purchaseOrder.id}` : ""}
                    </div>
                    {imported.invoiceDocumentPath || imported.sourceUrl ? (
                      <div className="text-xs text-slate-500">
                        {imported.invoiceDocumentPath ? `Invoice file: ${imported.invoiceDocumentPath}` : ""}
                        {imported.invoiceDocumentHash ? ` · SHA256 ${imported.invoiceDocumentHash.slice(0, 12)}…` : ""}
                        {imported.sourceUrl ? ` · Portal: ${imported.sourceUrl}` : ""}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-2 md:items-end">
                    {!imported.purchaseOrder && !imported.archivedAt ? (
                      <RefreshingActionForm action={applyAlibabaEmailImportAction}>
                        <input type="hidden" name="importId" value={imported.id} />
                        <button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50">
                          Re-match current items & apply
                        </button>
                      </RefreshingActionForm>
                    ) : null}
                    {!imported.archivedAt ? (
                      <RefreshingActionForm action={archiveAlibabaEmailImportAction}>
                        <input type="hidden" name="importId" value={imported.id} />
                        <input type="hidden" name="returnTo" value="/integrations/email-import" />
                        <button className="rounded-md border border-amber-300 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50">
                          Ignore & archive
                        </button>
                      </RefreshingActionForm>
                    ) : (
                      <div className="flex flex-col gap-2 md:items-end">
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                          Archived{imported.archivedBy ? ` by ${imported.archivedBy}` : ""}{imported.archiveReason ? ` · ${imported.archiveReason}` : ""}
                        </div>
                        <RefreshingActionForm action={unarchiveAlibabaEmailImportAction}>
                          <input type="hidden" name="importId" value={imported.id} />
                          <button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                            Unarchive email
                          </button>
                        </RefreshingActionForm>
                        {!imported.purchaseOrder ? (
                          <RefreshingActionForm
                            action={deleteArchivedAlibabaEmailImportAction}
                            confirmMessage="Permanently delete archived email? This removes the archived import and parsed lines. It cannot be undone."
                          >
                            <input type="hidden" name="importId" value={imported.id} />
                            <button className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50">
                              Permanently delete archived email
                            </button>
                          </RefreshingActionForm>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">Line</th>
                        <th className="px-3 py-2 font-medium">Detected / editable description</th>
                        <th className="px-3 py-2 font-medium">Matched Lambenti item</th>
                        <th className="px-3 py-2 font-medium">Qty</th>
                        <th className="px-3 py-2 font-medium">Unit cost</th>
                        <th className="px-3 py-2 font-medium">Line subtotal</th>
                        <th className="px-3 py-2 font-medium">Match</th>
                        <th className="px-3 py-2 font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {imported.lines.map((line) => {
                        const formId = `email-line-${line.id}`;
                        const editable = !imported.purchaseOrder && !imported.archivedAt;
                        return (
                          <tr key={line.id} className="border-t border-slate-100 align-top">
                            <td className="px-3 py-2">
                              {line.lineNo}
                              {editable ? (
                                <RefreshingActionForm id={formId} action={updateAlibabaEmailLineAction}>
                                  <input type="hidden" name="lineId" value={line.id} />
                                </RefreshingActionForm>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 min-w-72">
                              {editable ? (
                                <input form={formId} name="rawDescription" defaultValue={line.rawDescription} className="w-full rounded-md border px-2 py-1" />
                              ) : line.rawDescription}
                            </td>
                            <td className="px-3 py-2 min-w-64">
                              {editable ? (
                                <select form={formId} name="matchedItemId" defaultValue={line.matchedItemId ?? ""} className="w-full rounded-md border px-2 py-1">
                                  <option value="">Needs review</option>
                                  {itemOptions.map((item) => (
                                    <option key={item.id} value={item.id}>{item.sku} — {item.description}</option>
                                  ))}
                                </select>
                              ) : line.matchedItem?.sku ?? "Needs review"}
                            </td>
                            <td className="px-3 py-2">
                              {editable ? (
                                <input form={formId} name="quantity" type="number" min="1" defaultValue={line.quantity} className="w-20 rounded-md border px-2 py-1" />
                              ) : line.quantity}
                            </td>
                            <td className="px-3 py-2">
                              {editable ? (
                                <div className="flex gap-1">
                                  <input form={formId} name="currency" defaultValue={line.currency} className="w-16 rounded-md border px-2 py-1" />
                                  <input form={formId} name="unitPrice" type="number" min="0" step="0.0001" defaultValue={line.unitPrice?.toString() ?? ""} className="w-24 rounded-md border px-2 py-1" />
                                </div>
                              ) : `${line.currency} ${line.unitPrice?.toString() ?? "unknown"}`}
                            </td>
                            <td className="px-3 py-2">{line.currency} {line.lineTotal?.toString() ?? "unknown"}</td>
                            <td className="px-3 py-2">{line.matchConfidence}</td>
                            <td className="px-3 py-2">
                              {editable ? (
                                <button form={formId} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-50">Save line</button>
                              ) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function displayEmailImportSource(source: string) {
  switch (source) {
    case "SYNCED_EMAIL":
      return "Synced email";
    case "MANUAL_CSV_IMPORT":
      return "Manual CSV import";
    case "MANUAL_EMAIL":
      return "Manual pasted email";
    case "ALIBABA_PORTAL":
      return "Alibaba portal";
    case "ALIBABA_EMAIL":
      return "Synced email (legacy)";
    default:
      return source.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
}
