import Link from "next/link";
import { getInvoiceDashboard } from "@/modules/accounting/invoices";
import { getAccountingWorkbench, type AccountingDocumentAnalysis } from "@/modules/accounting/documents";
import { hasPermission, requirePermission } from "@/modules/auth/permissions";
import { RefreshingActionForm } from "@/app/refreshing-action-form";
import { AccountingDocumentDropzone } from "./accounting-document-dropzone";
import { applyAccountingDocumentAction, attachAccountingDocumentEvidenceAction, deleteAccountingDocumentAction, retryAccountingDocumentExtractionAction, updateAccountingDocumentTextAction } from "./actions";

export const dynamic = "force-dynamic";

function money(currency: string, value: { toString(): string } | number | null | undefined) {
  if (value == null) return `${currency}0.00`;
  const numeric = typeof value === "number" ? value : Number(value.toString());
  return `${currency}${numeric.toFixed(2)}`;
}

function analysisFrom(value: unknown): AccountingDocumentAnalysis | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<AccountingDocumentAnalysis>;
  return candidate.schemaVersion === "accounting-document-v1" ? candidate as AccountingDocumentAnalysis : undefined;
}

type AccountingDocumentRow = {
  status: string;
  supplierInvoiceId: string | null;
  extractedText: string | null;
  errorMessage: string | null;
  analysisJson: unknown;
};

type DocumentTriageSummary = {
  total: number;
  readyToApply: number;
  needsManualReview: number;
  attachOnly: number;
  evidenceLinked: number;
  unreadable: number;
};

function documentNeedsManualReview(document: AccountingDocumentRow, analysis?: AccountingDocumentAnalysis) {
  return document.status === "FAILED"
    || document.status === "NEEDS_REVIEW"
    || !document.extractedText
    || Boolean(document.errorMessage)
    || (analysis?.requiredReview?.length ?? 0) > 0;
}

function documentIsReadyToApply(document: AccountingDocumentRow, analysis?: AccountingDocumentAnalysis) {
  return document.status !== "APPLIED"
    && document.status !== "ATTACHED"
    && !document.supplierInvoiceId
    && analysis?.classification === "SUPPLIER_INVOICE"
    && !documentNeedsManualReview(document, analysis);
}

function getDocumentTriageSummary(documents: AccountingDocumentRow[]): DocumentTriageSummary {
  return documents.reduce<DocumentTriageSummary>((summary, document) => {
    const analysis = analysisFrom(document.analysisJson);
    const isLinked = document.status === "APPLIED" || document.status === "ATTACHED" || Boolean(document.supplierInvoiceId);
    const isReady = documentIsReadyToApply(document, analysis);
    const needsReview = !isLinked && !isReady && documentNeedsManualReview(document, analysis);

    summary.total += 1;
    if (!document.extractedText) summary.unreadable += 1;
    if (isLinked) summary.evidenceLinked += 1;
    else if (isReady) summary.readyToApply += 1;
    else if (needsReview) summary.needsManualReview += 1;
    else summary.attachOnly += 1;
    return summary;
  }, { total: 0, readyToApply: 0, needsManualReview: 0, attachOnly: 0, evidenceLinked: 0, unreadable: 0 });
}

function documentReadiness(document: AccountingDocumentRow, analysis?: AccountingDocumentAnalysis) {
  if (document.status === "APPLIED") {
    return { label: "Applied to AP", className: "border-emerald-200 bg-emerald-50 text-emerald-800", helper: "Supplier invoice provenance is linked; keep source evidence immutable." };
  }
  if (document.status === "ATTACHED" || document.supplierInvoiceId) {
    return { label: "Attached evidence", className: "border-blue-200 bg-blue-50 text-blue-800", helper: "Supporting document is bundled with invoice/PO evidence." };
  }
  if (documentIsReadyToApply(document, analysis)) {
    return { label: "Ready to apply", className: "border-emerald-200 bg-emerald-50 text-emerald-800", helper: "Clean supplier invoice extraction; review PO selection before creating/updating AP." };
  }
  if (documentNeedsManualReview(document, analysis)) {
    return { label: "Needs manual review", className: "border-amber-200 bg-amber-50 text-amber-800", helper: document.errorMessage ?? "Resolve extraction warnings, retry OCR, or paste source text before applying." };
  }
  if (analysis?.classification && analysis.classification !== "SUPPLIER_INVOICE") {
    return { label: "Evidence only", className: "border-slate-200 bg-slate-50 text-slate-700", helper: "Attach as support; non-invoice evidence does not create AP, payment, or stock changes." };
  }
  return { label: "Saved evidence", className: "border-slate-200 bg-slate-50 text-slate-700", helper: "Keep linked to source hash/path until review determines the next accounting action." };
}

export default async function AccountingWorkbenchPage() {
  const actor = await requirePermission("accounting:view");
  const canApplyDocuments = hasPermission(actor, "invoice:create");
  const [{ invoices, uninvoicedPurchaseOrders, totalsByStatus }, { documents }] = await Promise.all([
    getInvoiceDashboard(),
    getAccountingWorkbench()
  ]);
  const receivedTotal = totalsByStatus.RECEIVED?.toString() ?? "0";
  const approvedTotal = totalsByStatus.APPROVED?.toString() ?? "0";
  const paidTotal = totalsByStatus.PAID?.toString() ?? "0";
  const receivedInvoices = invoices.filter((invoice) => invoice.status === "RECEIVED").length;
  const approvedInvoices = invoices.filter((invoice) => invoice.status === "APPROVED").length;
  const documentTriage = getDocumentTriageSummary(documents);
  const attentionItems = [
    {
      href: "#source-document-review-queue",
      count: documentTriage.readyToApply,
      label: "clean supplier invoice document(s) ready to apply",
      detail: "Create/update AP only after reviewing the suggested PO/invoice links.",
      tone: "emerald"
    },
    {
      href: "#source-document-review-queue",
      count: documentTriage.needsManualReview,
      label: "source document(s) need manual review",
      detail: "Resolve OCR, missing invoice number, total, supplier, or classification warnings before applying.",
      tone: "amber"
    },
    {
      href: "/accounting/invoices",
      count: receivedInvoices,
      label: "received invoice(s) waiting for approval",
      detail: "Approval posts AP journals only when GL mappings and evidence are ready.",
      tone: "blue"
    },
    {
      href: "/accounting/payments",
      count: approvedInvoices,
      label: "approved invoice(s) ready for payment reconciliation",
      detail: "Payment still needs an explicit reference or bank allocation.",
      tone: "blue"
    },
    {
      href: "#uninvoiced-purchase-orders",
      count: uninvoicedPurchaseOrders.length,
      label: "incoming PO(s) still missing invoice evidence",
      detail: "Upload supplier invoices or create them manually; physical receiving stays on /incoming.",
      tone: "slate"
    }
  ].filter((item) => item.count > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Accounting workbench</h1>
          <p className="max-w-4xl text-sm text-slate-600">
            Accounting documents do not receive stock, approve purchases, or mark invoices paid. This page preserves source document evidence,
            extracts accounting fields, dedupes files, and prepares serious AP records for human review.
          </p>
        </div>
        <Link href="/accounting/invoices" className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Open invoice ledger</Link>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="Supplier invoices" value={invoices.length.toString()} subtext="AP records in the app" />
        <SummaryCard label="Received / unpaid" value={`USD${Number(receivedTotal).toFixed(2)}`} subtext="Needs approval/payment review" />
        <SummaryCard label="Approved" value={`USD${Number(approvedTotal).toFixed(2)}`} subtext="Payment-ready with reference required" />
        <SummaryCard label="Paid" value={`USD${Number(paidTotal).toFixed(2)}`} subtext="Immutable evidence retained" />
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-medium">Attention queue</h2>
              <p className="text-xs text-slate-500">Prioritized exceptions and next accounting actions, surfaced before the feature grid.</p>
            </div>
            <span className="rounded-full border border-slate-200 px-2 py-1 text-xs text-slate-600">{attentionItems.length} active</span>
          </div>
          <div className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-100">
            {attentionItems.length === 0 ? (
              <div className="p-3 text-sm text-emerald-700">No active accounting exceptions. Upload evidence as supplier records arrive.</div>
            ) : attentionItems.map((item) => (
              <Link key={item.href + item.label} href={item.href} className="grid gap-2 p-3 text-sm hover:bg-slate-50 sm:grid-cols-[auto_1fr_auto] sm:items-center">
                <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${attentionToneClass(item.tone)}`}>{item.count}</span>
                <span>
                  <span className="block font-medium text-slate-900">{item.label}</span>
                  <span className="block text-xs text-slate-500">{item.detail}</span>
                </span>
                <span className="text-xs font-medium text-blue-700">Open →</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-medium">Accounting control trail</h2>
          <p className="mt-1 text-xs text-slate-500">Upload → review → apply/attach → approve/pay → post/export</p>
          <ol className="mt-3 space-y-2 text-sm text-slate-700">
            <li><span className="font-medium">1. Capture evidence:</span> private source file, hash, OCR/text, and upload actor.</li>
            <li><span className="font-medium">2. Triage exceptions:</span> warnings stay visible until a human resolves or attaches them.</li>
            <li><span className="font-medium">3. Act explicitly:</span> AP, approval, payment, and journals remain separate human-gated steps.</li>
          </ol>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-medium">Source document triage</h2>
            <p className="text-xs text-slate-500">Fast scan of saved documents so review starts with exceptions, not a raw table.</p>
          </div>
          <Link href="#source-document-review-queue" className="text-xs font-medium text-blue-700 hover:underline">Jump to review queue</Link>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-5">
          <MiniMetric label="Ready to apply" value={documentTriage.readyToApply.toString()} text="Clean supplier invoices" tone="emerald" />
          <MiniMetric label="Needs manual review" value={documentTriage.needsManualReview.toString()} text="Warnings, OCR, or missing fields" tone="amber" />
          <MiniMetric label="Attach only" value={documentTriage.attachOnly.toString()} text="Receipts, packing, customs, quotes" tone="slate" />
          <MiniMetric label="Linked evidence" value={documentTriage.evidenceLinked.toString()} text="Applied or attached bundles" tone="blue" />
          <MiniMetric label="Unreadable/no text" value={documentTriage.unreadable.toString()} text="Retry OCR or paste text" tone="red" />
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-6">
        <AccountingLink href="/accounting/customer-invoices" title="Customer invoices / AR" text="Draft and track customer-facing invoices without stock mutation." />
        <AccountingLink href="/accounting/payments" title="Payment reconciliation" text="Import bank transactions and reconcile approved invoices." />
        <AccountingLink href="/accounting/journals" title="Posted journals" text="Review posted balanced journals from AP invoice approval and AP payment reconciliation." />
        <AccountingLink href="/accounting/exports" title="GST/HST exports" text="Download accountant-review CSV with ITC evidence warnings." />
        <AccountingLink href="/accounting/accounts" title="GL mapping" text="Maintain chart-of-accounts mappings used by posted journals and exports." />
        <AccountingLink href="/accounting/landed-cost" title="Landed cost" text="Allocate freight/duty/non-recoverable tax without stock mutation." />
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-4">
          <h2 className="font-medium">Drop source documents</h2>
          <p className="text-xs text-slate-500">
            Best format: private original file/email + SHA-256 hash + extracted text/OCR + structured AccountingDocument analysis + audited invoice/payment links.
          </p>
        </div>
        {canApplyDocuments ? <AccountingDocumentDropzone /> : <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Your role can view accounting evidence but cannot upload or re-analyze source documents.</p>}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-medium">Canadian GST/HST and audit-ready records</h2>
          <div className="mt-3 grid gap-3 text-sm text-slate-700 md:grid-cols-2">
            <Checklist title="Source evidence" items={["Original PDF/email/screenshot stored privately", "SHA-256 hash and upload actor", "OCR/extraction text retained separately", "Human corrections create audit history"]} />
            <Checklist title="AP invoice fields" items={["Supplier legal name, invoice number/date/due date", "Currency, subtotal, shipping, tax, total", "Line quantities, SKU/part, unit price, tax treatment", "PO/receiving/customs/payment references"]} />
            <Checklist title="Tax and landed cost" items={["GST/HST ITC evidence and supplier tax number when required", "Recoverable tax separated from landed cost", "Duties, brokerage, freight, and non-recoverable tax tracked", "Currency/FX source preserved"]} />
            <Checklist title="Retention and controls" items={["Keep supporting records for at least six years", "Deduplicate by hash and supplier invoice key", "No payment without reference evidence", "No stock movement from accounting upload"]} />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-medium">Invoice functionality upgrades active here</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            <li><span className="font-medium">Evidence bundle:</span> multiple source documents can be attached to the same supplier invoice/PO with hash/path provenance.</li>
            <li><span className="font-medium">Multi-invoice POs:</span> deposits, partial/final invoices, and credit-note style records can share one PO while supplier invoice numbers are unique per supplier.</li>
            <li><span className="font-medium">Customer invoices / AR:</span> draft, send, and mark customer-facing invoices paid without consuming stock or shipping products.</li>
            <li><span className="font-medium">Payment reconciliation:</span> bank transactions are deduped by hash and explicitly allocated to approved invoices before marking paid.</li>
            <li><span className="font-medium">GST/HST exports:</span> accountant CSV rows separate recoverable and non-recoverable tax with source-evidence warnings.</li>
            <li><span className="font-medium">Posted journals:</span> approving AP invoices and reconciling AP payments now creates immutable, balanced journal entries with account snapshots.</li>
            <li><span className="font-medium">GL mapping / landed cost:</span> chart mappings drive posted journals and landed-cost allocation reports without posting stock side effects.</li>
            <li><span className="font-medium">Automatic extraction:</span> PDFs, emails, text, and screenshot OCR are analyzed into invoice/order/payment fields.</li>
            <li><span className="font-medium">Review gates:</span> uncertain or non-invoice documents stay in review instead of posting AP.</li>
            <li><span className="font-medium">3-way boundary:</span> invoices can link to POs, but receiving remains on the `/incoming` workbench.</li>
            <li><span className="font-medium">Audit trail:</span> upload/apply/reconcile actions are logged and source documents are immutable/deduped.</li>
          </ul>
        </div>
      </section>

      <section id="source-document-review-queue" className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="font-medium">Saved source document review queue</h2>
          <p className="text-xs text-slate-500">Analyze, review, apply to invoices, or keep as evidence. Uploads never mutate stock quantities.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Source document</th>
                <th className="px-4 py-3">Detected record</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Review / action</th>
                <th className="px-4 py-3">Links</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {documents.length === 0 ? (
                <tr><td className="px-4 py-6 text-slate-500" colSpan={5}>No accounting source documents saved yet.</td></tr>
              ) : documents.map((document) => {
                const analysis = analysisFrom(document.analysisJson);
                const matchedPurchaseOrderId = document.purchaseOrderId ?? analysis?.matchedPurchaseOrderId;
                const matchedSupplierInvoiceId = document.supplierInvoiceId ?? analysis?.matchedSupplierInvoiceId;
                const hasRequiredReview = (analysis?.requiredReview?.length ?? 0) > 0;
                const readiness = documentReadiness(document, analysis);
                const canApply = canApplyDocuments && !document.supplierInvoiceId && analysis?.classification === "SUPPLIER_INVOICE" && !hasRequiredReview;
                const canAttach = canApplyDocuments && document.status !== "APPLIED" && document.status !== "ATTACHED";
                const canDeleteSourceDocument = canApplyDocuments
                  && document.status !== "APPLIED"
                  && document.status !== "ATTACHED";
                return (
                  <tr key={document.id} className="align-top">
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium">{document.originalFileName}</div>
                        <span data-testid="accounting-document-status" className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${readiness.className}`}>{readiness.label}</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{document.status} · {document.sourceKind} · SHA256 {document.sha256.slice(0, 12)}…</div>
                      <div className="mt-1 text-xs text-slate-500">{readiness.helper}</div>
                      <div className="mt-1 max-w-xs truncate text-xs text-slate-400">{document.storedPath}</div>
                      <Link href={`/api/accounting/documents/${document.id}/download`} className="mt-1 inline-block text-xs text-blue-700 hover:underline">Download source document</Link>
                    </td>
                    <td className="px-4 py-3">
                      <div>{analysis?.classification ?? "Unclassified"}</div>
                      <div className="text-xs text-slate-600">{analysis?.supplierName ?? document.supplier?.name ?? "Supplier unknown"}</div>
                      <div className="text-xs text-slate-500">{analysis?.invoiceNumber ? `Invoice ${analysis.invoiceNumber}` : "Invoice number not detected"}</div>
                      {document.extractedText ? (
                        <details className="mt-2 max-w-xs text-xs text-slate-500">
                          <summary className="cursor-pointer text-blue-700">Extracted text preview</summary>
                          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-2">{document.extractedText.slice(0, 800)}</pre>
                        </details>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {analysis?.total == null ? "—" : money(analysis.currency, analysis.total)}
                      {analysis?.taxCost != null ? <div className="text-xs text-slate-500">tax {money(analysis.currency, analysis.taxCost)}</div> : null}
                    </td>
                    <td className="px-4 py-3">
                      {analysis?.requiredReview?.length ? (
                        <ul className="mb-2 list-disc pl-4 text-xs text-amber-700">
                          {analysis.requiredReview.slice(0, 3).map((item) => <li key={item}>{item}</li>)}
                        </ul>
                      ) : <div className="mb-2 text-xs text-emerald-700">No blocking extraction warnings.</div>}
                      {canApply ? (
                        <RefreshingActionForm action={applyAccountingDocumentAction} className="space-y-2">
                          <input type="hidden" name="documentId" value={document.id} />
                          {matchedPurchaseOrderId ? (
                            <>
                              <input type="hidden" name="purchaseOrderId" value={matchedPurchaseOrderId} />
                              <div className="rounded border border-emerald-100 bg-emerald-50 px-2 py-1 text-xs text-emerald-800">Suggested PO {matchedPurchaseOrderId}</div>
                            </>
                          ) : (
                            <select name="purchaseOrderId" required className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs">
                              <option value="">Choose PO…</option>
                              {uninvoicedPurchaseOrders.map((order) => (
                                <option key={order.id} value={order.id}>{order.supplier.name} · {order.id}</option>
                              ))}
                            </select>
                          )}
                          <button className="rounded-md bg-ink px-2 py-1 text-xs font-medium text-white">Apply to invoice</button>
                        </RefreshingActionForm>
                      ) : <div className="text-xs text-slate-500">{analysis?.suggestedActions?.[0] ?? document.errorMessage ?? "Saved as source evidence."}</div>}

                      {canAttach ? (
                        <RefreshingActionForm action={attachAccountingDocumentEvidenceAction} className="mt-3 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                          <input type="hidden" name="documentId" value={document.id} />
                          <div className="text-xs font-medium text-slate-700">Attach only — does not receive stock or mark paid.</div>
                          {matchedSupplierInvoiceId ? (
                            <>
                              <input type="hidden" name="supplierInvoiceId" value={matchedSupplierInvoiceId} />
                              <div className="text-xs text-slate-600">Suggested invoice {document.supplierInvoice?.invoiceNumber ?? matchedSupplierInvoiceId}</div>
                            </>
                          ) : invoices.length > 0 ? (
                            <select name="supplierInvoiceId" className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs" defaultValue="">
                              <option value="">Choose invoice bundle…</option>
                              {invoices.map((invoice) => (
                                <option key={invoice.id} value={invoice.id}>{invoice.supplier.name} · {invoice.invoiceNumber}</option>
                              ))}
                            </select>
                          ) : null}
                          {matchedPurchaseOrderId ? (
                            <>
                              <input type="hidden" name="purchaseOrderId" value={matchedPurchaseOrderId} />
                              <div className="text-xs text-slate-600">Linked PO {matchedPurchaseOrderId}</div>
                            </>
                          ) : (
                            <select name="purchaseOrderId" className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs" defaultValue="">
                              <option value="">Optional PO evidence link…</option>
                              {uninvoicedPurchaseOrders.map((order) => (
                                <option key={order.id} value={order.id}>{order.supplier.name} · {order.id}</option>
                              ))}
                            </select>
                          )}
                          <button className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium hover:bg-slate-50">Attach as evidence</button>
                        </RefreshingActionForm>
                      ) : null}

                      {canApplyDocuments ? (
                        <div className="mt-3 space-y-2 border-t border-slate-100 pt-2">
                          <RefreshingActionForm action={retryAccountingDocumentExtractionAction} className="inline-block">
                            <input type="hidden" name="documentId" value={document.id} />
                            <button className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">Retry OCR/extraction</button>
                          </RefreshingActionForm>
                          <details className="text-xs text-slate-600">
                            <summary className="cursor-pointer text-blue-700">Paste extracted text / OCR and re-analyze</summary>
                            <RefreshingActionForm action={updateAccountingDocumentTextAction} className="mt-2 space-y-2">
                              <input type="hidden" name="documentId" value={document.id} />
                              <textarea
                                name="extractedText"
                                required
                                rows={5}
                                className="w-full rounded-md border border-slate-300 px-2 py-1 font-mono text-xs"
                                placeholder="Paste invoice/order/payment text visible in the saved source document. This re-analyzes evidence only; it does not receive stock, approve payment, or create AP without apply."
                              />
                              <button className="rounded-md bg-ink px-2 py-1 text-xs font-medium text-white">Save text & analyze</button>
                            </RefreshingActionForm>
                          </details>
                          {canDeleteSourceDocument ? (
                            <RefreshingActionForm
                              action={deleteAccountingDocumentAction}
                              className="text-xs text-slate-600"
                              confirmMessage="Delete this accounting source document? This permanently removes the saved file and analysis row. Applied or attached evidence cannot be deleted."
                            >
                              <input type="hidden" name="documentId" value={document.id} />
                              <button className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50">Delete source document</button>
                              <div className="mt-1 text-[11px] text-slate-500">This permanently removes the saved file and analysis row. It is only available before the document is attached or applied.</div>
                            </RefreshingActionForm>
                          ) : null}
                        </div>
                      ) : <div className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500">View-only: retry/manual re-analysis controls hidden.</div>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {matchedSupplierInvoiceId ? <div>Invoice {document.supplierInvoice?.invoiceNumber ?? matchedSupplierInvoiceId}</div> : null}
                      {matchedPurchaseOrderId ? <div>PO {matchedPurchaseOrderId}</div> : null}
                      {document.emailOrderImportId ? <div>Email import {document.emailOrderImportId}</div> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section id="uninvoiced-purchase-orders" className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="font-medium">Uninvoiced purchase orders</h2>
          <p className="text-xs text-slate-500">Accounting documents can be applied to these PO records after review. Physical receiving remains separate.</p>
        </div>
        <div className="divide-y divide-slate-100">
          {uninvoicedPurchaseOrders.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">No uninvoiced incoming purchase orders.</p>
          ) : uninvoicedPurchaseOrders.map((order) => {
            const subtotal = order.lines.reduce((total, line) => total + Number(line.unitPrice.toString()) * line.quantity, 0);
            return (
              <div key={order.id} className="grid gap-2 px-4 py-3 lg:grid-cols-[1fr_auto] lg:items-center">
                <div>
                  <div className="font-medium">PO {order.id}</div>
                  <div className="text-sm text-slate-600">{order.supplier.name} · {order.status} · {order.lines.length} line(s) · subtotal USD{subtotal.toFixed(2)}</div>
                </div>
                <Link href="/accounting/invoices" className="rounded-md border border-slate-300 px-3 py-2 text-xs hover:bg-slate-50">Create invoice manually</Link>
              </div>
            );
          })}
        </div>
      </section>
    </div>
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

function MiniMetric({ label, value, text, tone }: { label: string; value: string; text: string; tone: string }) {
  return (
    <div className={`rounded-md border p-3 ${miniMetricToneClass(tone)}`}>
      <div className="text-xs font-medium uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs opacity-80">{text}</div>
    </div>
  );
}

function attentionToneClass(tone: string) {
  if (tone === "emerald") return "bg-emerald-100 text-emerald-800";
  if (tone === "amber") return "bg-amber-100 text-amber-800";
  if (tone === "blue") return "bg-blue-100 text-blue-800";
  return "bg-slate-100 text-slate-700";
}

function miniMetricToneClass(tone: string) {
  if (tone === "emerald") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (tone === "amber") return "border-amber-200 bg-amber-50 text-amber-900";
  if (tone === "blue") return "border-blue-200 bg-blue-50 text-blue-900";
  if (tone === "red") return "border-red-200 bg-red-50 text-red-900";
  return "border-slate-200 bg-slate-50 text-slate-800";
}

function AccountingLink({ href, title, text }: { href: string; title: string; text: string }) {
  return (
    <Link href={href} className="rounded-md border border-slate-200 bg-white p-4 hover:border-slate-300 hover:bg-slate-50">
      <div className="text-sm font-medium text-slate-900">{title}</div>
      <div className="mt-1 text-xs text-slate-500">{text}</div>
    </Link>
  );
}

function Checklist({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-slate-900">{title}</h3>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-slate-600">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}
