import Link from "next/link";
import { getInvoiceDashboard, summarizeInvoiceWorkQueue } from "@/modules/accounting/invoices";
import { getAccountingWorkbench, type AccountingDocumentAnalysis } from "@/modules/accounting/documents";
import { getAttachedLandedCostEvidenceAmount } from "@/modules/accounting/landed-cost";
import { getAccountingCommandCenter } from "@/modules/accounting/overview";
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

function documentCanBeReanalyzed(document: AccountingDocumentRow) {
  return document.status !== "APPLIED"
    && document.status !== "ATTACHED"
    && document.status !== "ARCHIVED"
    && !document.supplierInvoiceId;
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
    return { label: "Ready to Apply", className: "border-emerald-200 bg-emerald-50 text-emerald-800", helper: "Clean supplier invoice extraction; review PO selection before creating/updating AP." };
  }
  if (documentNeedsManualReview(document, analysis)) {
    return { label: "Needs Manual Review", className: "border-amber-200 bg-amber-50 text-amber-800", helper: document.errorMessage ?? "Resolve extraction warnings, retry OCR, or paste source text before applying." };
  }
  if (analysis?.classification && analysis.classification !== "SUPPLIER_INVOICE") {
    return { label: "Evidence only", className: "border-slate-200 bg-slate-50 text-slate-700", helper: "Attach as support; non-invoice evidence does not create AP, payment, or stock changes." };
  }
  return { label: "Saved evidence", className: "border-slate-200 bg-slate-50 text-slate-700", helper: "Keep linked to source hash/path until review determines the next accounting action." };
}

type InvoiceDashboardRow = Awaited<ReturnType<typeof getInvoiceDashboard>>["invoices"][number];

function getAttachableInvoiceBundleOptions(invoices: InvoiceDashboardRow[]) {
  return invoices.filter((invoice) => invoice.status !== "VOID");
}

function invoiceBundleOptionLabel(invoice: InvoiceDashboardRow) {
  const poLabel = invoice.purchaseOrderId ? ` · PO ${invoice.purchaseOrderId.slice(-8).toUpperCase()}` : "";
  return `${invoice.supplier.name} · ${invoice.invoiceNumber} · ${invoice.status}${poLabel}`;
}

export default async function AccountingWorkbenchPage() {
  const actor = await requirePermission("accounting:view");
  const canApplyDocuments = hasPermission(actor, "invoice:create");
  const [{ invoices, uninvoicedPurchaseOrders, totalsByStatus, paidEvidenceTotal }, { documents }, commandCenter] = await Promise.all([
    getInvoiceDashboard(),
    getAccountingWorkbench(),
    getAccountingCommandCenter()
  ]);
  const receivedTotal = totalsByStatus.RECEIVED?.toString() ?? "0";
  const approvedTotal = totalsByStatus.APPROVED?.toString() ?? "0";
  const paidTotal = paidEvidenceTotal.toString();
  const approvedInvoices = invoices.filter((invoice) => invoice.status === "APPROVED").length;
  const attachableInvoiceBundles = getAttachableInvoiceBundleOptions(invoices);
  const invoiceWorkQueue = summarizeInvoiceWorkQueue(invoices);
  const documentTriage = getDocumentTriageSummary(documents);
  const attentionItems = [
    {
      href: "#payables-aging",
      count: commandCenter.payables.overdue.count,
      label: "Overdue Supplier Payable(s)",
      detail: "Handle Overdue Bills First, Then Due-This-Week and No-Due-Date Invoices.",
      tone: "amber"
    },
    {
      href: "/accounting/accounts",
      count: commandCenter.glSetup.missingPurposes.length,
      label: "Required default GL Mapping(s) missing",
      detail: "Posting Setup Must Be Complete Before AP Approval/Payment Journals Can Post Cleanly.",
      tone: "amber"
    },
    {
      href: "#source-document-review-queue",
      count: documentTriage.readyToApply,
      label: "Clean Supplier Invoice Document(s) Ready to Apply",
      detail: "Create/Update AP Only After Reviewing the Suggested PO/Invoice Links.",
      tone: "emerald"
    },
    {
      href: "#source-document-review-queue",
      count: documentTriage.needsManualReview,
      label: "Source Document(s) Need Manual Review",
      detail: "Resolve OCR, Missing Invoice Number, Total, Supplier, or Classification Warnings Before Applying.",
      tone: "amber"
    },
    {
      href: "/accounting/invoices",
      count: invoiceWorkQueue.approvalBlockedCount,
      label: "Invoice(s) Blocked Before Approval",
      detail: "Set Due Dates or Attach Source Evidence Before Posting AP Journals.",
      tone: "amber"
    },
    {
      href: "/accounting/invoices",
      count: invoiceWorkQueue.approvalReadyCount,
      label: "Invoice(s) Ready for Approval",
      detail: "Approval Still Requires Explicit Human Action and Posts AP Journals Only After Blockers Are Clear.",
      tone: "blue"
    },
    {
      href: "/accounting/payments",
      count: approvedInvoices,
      label: "Approved Invoice(s) Ready for Payment Reconciliation",
      detail: "Payment Still Needs an Explicit Reference or Bank Allocation.",
      tone: "blue"
    },
    {
      href: "#uninvoiced-purchase-orders",
      count: uninvoicedPurchaseOrders.length,
      label: "Incoming PO(s) Still Missing Invoice Evidence",
      detail: "Upload Supplier Invoices or Create Them Manually; Physical Receiving Stays on /incoming.",
      tone: "slate"
    }
  ].filter((item) => item.count > 0);
  const bookkeepingSteps = [
    {
      label: "Capture",
      value: "Drop Source Documents",
      detail: "Keep PDFs/Emails/Screenshots Hashed and Private Before Any AP Action.",
      href: "#drop-source-documents",
      tone: "slate"
    },
    {
      label: "Review",
      value: `${documentTriage.readyToApply + documentTriage.needsManualReview} document(s)`,
      detail: "Apply Clean Supplier Invoices; Retry OCR or Paste Text for Review Blockers.",
      href: "#source-document-review-queue",
      tone: documentTriage.needsManualReview > 0 ? "amber" : "emerald"
    },
    {
      label: "Setup",
      value: commandCenter.glSetup.readyForPosting ? "Posting Ready" : `${commandCenter.glSetup.missingPurposes.length} mapping(s) missing`,
      detail: commandCenter.glSetup.readyForPosting ? "Default AP Journal Mappings Are Active." : `Missing ${commandCenter.glSetup.missingPurposes.join(", ")}.`,
      href: "/accounting/accounts",
      tone: commandCenter.glSetup.readyForPosting ? "emerald" : "amber"
    },
    {
      label: "Approve",
      value: `${invoiceWorkQueue.approvalReadyCount} ready · ${invoiceWorkQueue.approvalBlockedCount} blocked`,
      detail: "Only Blocker-Free Received Invoices Can Be Approved from the Queue.",
      href: "/accounting/invoices",
      tone: invoiceWorkQueue.approvalBlockedCount > 0 ? "amber" : invoiceWorkQueue.approvalReadyCount > 0 ? "blue" : "slate"
    },
    {
      label: "Pay",
      value: `${approvedInvoices + commandCenter.bank.unmatchedCount} item(s)`,
      detail: "Reconcile Approved Invoices to Bank/Payment Evidence; Imported Rows Stay Unmatched Until Allocated.",
      href: "/accounting/payments",
      tone: approvedInvoices + commandCenter.bank.unmatchedCount > 0 ? "blue" : "slate"
    }
  ];
  const actionableBookkeepingIndex = bookkeepingSteps.findIndex((step) => step.tone === "amber" || step.tone === "blue");
  const nextBookkeepingIndex = actionableBookkeepingIndex >= 0 ? actionableBookkeepingIndex : 0;
  const triageCards = [
    { label: "Needs Manual Review", value: documentTriage.needsManualReview.toString(), text: "Warnings, OCR, or Missing Fields", tone: "amber" },
    { label: "Unreadable/No Text", value: documentTriage.unreadable.toString(), text: "Retry OCR or Paste Text", tone: "red" },
    { label: "Ready to Apply", value: documentTriage.readyToApply.toString(), text: "Clean Supplier Invoices", tone: "emerald" },
    { label: "Attach Only", value: documentTriage.attachOnly.toString(), text: "Receipts, Packing, Customs, Quotes", tone: "slate" },
    { label: "Linked Evidence", value: documentTriage.evidenceLinked.toString(), text: "Applied or Attached Bundles", tone: "blue" }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Accounting Workbench</h1>
        </div>
        <Link href="/accounting/invoices" className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Open Invoice Ledger</Link>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="Supplier Invoices" value={invoices.length.toString()} subtext="AP records in the app" />
        <SummaryCard label="Received / unpaid" value={`USD${Number(receivedTotal).toFixed(2)}`} subtext="Needs approval/payment review" />
        <SummaryCard label="Approved" value={`USD${Number(approvedTotal).toFixed(2)}`} subtext="Payment-Ready with reference required" />
        <SummaryCard label="Paid" value={`USD${Number(paidTotal).toFixed(2)}`} subtext="Immutable evidence retained for received + open components" />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Bookkeeping Workflow Rail">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-medium">Daily Bookkeeping Routine</h2>
            <p className="text-xs text-slate-500">Capture → Review → Setup → Approve → Pay, with the next actionable step highlighted.</p>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">Evidence Only Until Apply</span>
        </div>
        <ol className="mt-4 grid gap-3 md:grid-cols-5">
          {bookkeepingSteps.map((step, index) => (
            <li key={step.label}>
              <Link href={step.href} className={workflowStepClass(step.tone, index === nextBookkeepingIndex)}>
                <span className={workflowStepNumberClass(step.tone)}>{index + 1}</span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold uppercase tracking-wide opacity-75">{step.label}</span>
                  <span className="mt-1 block text-sm font-semibold">{step.value}</span>
                  <span className="mt-1 block text-xs leading-5 opacity-80">{step.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section id="payables-aging" className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-medium">Command Center</h2>
          </div>
          <span className="rounded-full border border-slate-200 px-2 py-1 text-xs text-slate-600">{commandCenter.postedJournalCount} posted journal(s)</span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <CommandMetric
            title="Open payables"
            value={money(commandCenter.payables.currency, commandCenter.payables.openTotal)}
            detail={`${commandCenter.payables.openCount} open · ${commandCenter.payables.receivedCount} received · ${commandCenter.payables.approvedCount} approved`}
            tone={commandCenter.payables.overdue.count > 0 ? "amber" : "slate"}
          />
          <CommandMetric
            title="Overdue / Due Soon"
            value={`${commandCenter.payables.overdue.count} / ${commandCenter.payables.dueNext7Days.count}`}
            detail={`${money(commandCenter.payables.currency, commandCenter.payables.overdue.total)} overdue · ${money(commandCenter.payables.currency, commandCenter.payables.dueNext7Days.total)} due ≤7d`}
            tone={commandCenter.payables.overdue.count > 0 ? "amber" : "blue"}
          />
          <CommandMetric
            title="Bank Reconciliation"
            value={`${commandCenter.bank.unmatchedCount} unmatched`}
            detail={`${money("USD", commandCenter.bank.outgoingTotal)} outgoing · ${money("USD", commandCenter.bank.incomingTotal)} incoming`}
            tone={commandCenter.bank.unmatchedCount > 0 ? "blue" : "emerald"}
          />
          <CommandMetric
            title="Posting Setup"
            value={commandCenter.glSetup.readyForPosting ? "Ready" : "Blocked"}
            detail={commandCenter.glSetup.readyForPosting ? "All default mappings configured" : `${commandCenter.glSetup.missingPurposes.length} required mapping(s) missing`}
            tone={commandCenter.glSetup.readyForPosting ? "emerald" : "amber"}
          />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)]">
          <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
            <h3 className="text-sm font-medium text-slate-900">Next Supplier Bills</h3>
            <div className="mt-2 divide-y divide-slate-200 text-sm">
              {commandCenter.payables.nextDueInvoices.length === 0 ? (
                <p className="py-3 text-slate-500">No open supplier payables.</p>
              ) : commandCenter.payables.nextDueInvoices.map((invoice) => (
                <div key={invoice.id} className="grid gap-2 py-2 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div>
                    <div className="font-medium text-slate-900">{invoice.supplierName} · {invoice.invoiceNumber}</div>
                    <div className="text-xs text-slate-500">{invoice.status} · {invoice.evidenceCount} evidence document(s) · due {invoice.dueDate ?? "not set"}</div>
                  </div>
                  <div className="text-left sm:text-right">
                    <div className="font-medium">{money(invoice.currency, invoice.openBalance)}</div>
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${urgencyClass(invoice.urgency)}`}>{invoice.dueLabel}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
            <h3 className="text-sm font-medium text-slate-900">Bookkeeping Step Details</h3>
            <ol className="mt-2 space-y-2">
              {bookkeepingSteps.map((step, index) => (
                <li key={step.label}>
                  <Link href={step.href} className="grid grid-cols-[auto_1fr] gap-2 rounded-md border border-slate-200 bg-white p-2 text-sm hover:bg-slate-50">
                    <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${attentionToneClass(step.tone)}`}>{index + 1}</span>
                    <span>
                      <span className="block font-medium text-slate-900">{step.label}: {step.value}</span>
                      <span className="block text-xs text-slate-500">{step.detail}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-medium">Attention Queue</h2>
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
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-medium">Source Document Triage</h2>
            <p className="text-xs text-slate-500">Fast scan of saved documents so review starts with exceptions, not a raw table.</p>
          </div>
          <Link href="#source-document-review-queue" className="text-xs font-medium text-blue-700 hover:underline">Jump to Review Queue</Link>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-5">
          {triageCards.map((card) => (
            <MiniMetric key={card.label} href="#source-document-review-queue" label={card.label} value={card.value} text={card.text} tone={card.tone} />
          ))}
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-6">
        <AccountingLink href="/accounting/customer-invoices" title="Customer Invoices / AR" text="Draft and Track Customer-Facing Invoices Without Stock Mutation." />
        <AccountingLink href="/accounting/payments" title="Payment Reconciliation" text="Import Bank Transactions and Reconcile Approved Invoices." />
        <AccountingLink href="/accounting/journals" title="Posted Journals" text="Review Posted Balanced Journals from AP Invoice Approval and AP Payment Reconciliation." />
        <AccountingLink href="/accounting/exports" title="GST/HST Exports" text="Download Accountant-Review CSV with ITC Evidence Warnings." />
        <AccountingLink href="/accounting/accounts" title="GL Mapping" text="Maintain Chart-of-Accounts Mappings Used by Posted Journals and Exports." />
        <AccountingLink href="/accounting/landed-cost" title="Landed Cost" text="Allocate Freight/Duty/Non-Recoverable Tax Without Stock Mutation." />
      </section>

      <section id="drop-source-documents" className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-4">
          <h2 className="font-medium">Drop Source Documents</h2>
          <p className="text-xs text-slate-500">
            Best format: private original file/email + SHA-256 hash + extracted text/OCR + structured AccountingDocument analysis + audited invoice/payment links.
          </p>
        </div>
        {canApplyDocuments ? <AccountingDocumentDropzone /> : <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Your role can view accounting evidence but cannot upload or re-analyze source documents.</p>}
      </section>

      <section id="source-document-review-queue" className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="font-medium">Saved Source Document Review Queue</h2>
          <p className="text-xs text-slate-500">Analyze, review, apply to invoices, or keep as evidence. Uploads never mutate stock quantities.</p>
          <div className="mt-2 inline-flex rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-800">Evidence Only Until Apply · Retry/manual OCR edits lock after attach or apply.</div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Source Document</th>
                <th className="px-4 py-3">Detected Record</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Review / Action</th>
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
                const canReanalyze = canApplyDocuments && documentCanBeReanalyzed(document);
                const canDeleteSourceDocument = canApplyDocuments
                  && document.status !== "APPLIED"
                  && document.status !== "ATTACHED";
                const landedCostEvidence = getAttachedLandedCostEvidenceAmount({
                  originalFileName: document.originalFileName,
                  extractedText: document.extractedText,
                  analysisJson: document.analysisJson
                });
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
                      <Link href={`/api/accounting/documents/${document.id}/download`} className="mt-1 inline-block text-xs text-blue-700 hover:underline">Download Source Document</Link>
                    </td>
                    <td className="px-4 py-3">
                      <div>{analysis?.classification ?? "Unclassified"}</div>
                      <div className="text-xs text-slate-600">{analysis?.supplierName ?? document.supplier?.name ?? "Supplier unknown"}</div>
                      <div className="text-xs text-slate-500">{analysis?.invoiceNumber ? `Invoice ${analysis.invoiceNumber}` : "Invoice number not detected"}</div>
                      {document.extractedText ? (
                        <details className="mt-2 max-w-xs text-xs text-slate-500">
                          <summary className="cursor-pointer text-blue-700">Extracted Text Preview</summary>
                          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-2">{document.extractedText.slice(0, 800)}</pre>
                        </details>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {analysis?.total == null
                        ? landedCostEvidence ? money(landedCostEvidence.currency, landedCostEvidence.amount) : "—"
                        : money(analysis.currency, analysis.total)}
                      {analysis?.total == null && landedCostEvidence ? <div className="text-xs text-emerald-600">landed-cost evidence detected</div> : null}
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
                          <button className="rounded-md bg-ink px-2 py-1 text-xs font-medium text-white">Apply to Invoice</button>
                        </RefreshingActionForm>
                      ) : <div className="text-xs text-slate-500">{analysis?.suggestedActions?.[0] ?? document.errorMessage ?? "Saved as source evidence."}</div>}

                      {canAttach ? (
                        <RefreshingActionForm action={attachAccountingDocumentEvidenceAction} className="mt-3 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                          <input type="hidden" name="documentId" value={document.id} />
                          <div className="text-xs font-medium text-slate-700">Attach Only — Does Not Receive Stock or Mark Paid.</div>
                          {matchedSupplierInvoiceId ? (
                            <>
                              <input type="hidden" name="supplierInvoiceId" value={matchedSupplierInvoiceId} />
                              <div className="text-xs text-slate-600">Suggested invoice {document.supplierInvoice?.invoiceNumber ?? matchedSupplierInvoiceId}</div>
                            </>
                          ) : attachableInvoiceBundles.length > 0 ? (
                            <select name="supplierInvoiceId" className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs" defaultValue="">
                              <option value="">Choose Invoice Bundle…</option>
                              {attachableInvoiceBundles.map((invoice) => (
                                <option key={invoice.id} value={invoice.id}>{invoiceBundleOptionLabel(invoice)}</option>
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
                              <option value="">Optional PO Evidence Link…</option>
                              {uninvoicedPurchaseOrders.map((order) => (
                                <option key={order.id} value={order.id}>{order.supplier.name} · {order.id}</option>
                              ))}
                            </select>
                          )}
                          <button className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium hover:bg-slate-50">Attach as Evidence</button>
                        </RefreshingActionForm>
                      ) : null}

                      {canReanalyze ? (
                        <div className="mt-3 space-y-2 border-t border-slate-100 pt-2">
                          <RefreshingActionForm action={retryAccountingDocumentExtractionAction} className="inline-block">
                            <input type="hidden" name="documentId" value={document.id} />
                            <button className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">Retry OCR/Extraction</button>
                          </RefreshingActionForm>
                          <details className="text-xs text-slate-600">
                            <summary className="cursor-pointer text-blue-700">Paste Extracted Text / OCR and Re-Analyze</summary>
                            <RefreshingActionForm action={updateAccountingDocumentTextAction} className="mt-2 space-y-2">
                              <input type="hidden" name="documentId" value={document.id} />
                              <textarea
                                name="extractedText"
                                required
                                rows={5}
                                className="w-full rounded-md border border-slate-300 px-2 py-1 font-mono text-xs"
                                placeholder="Paste invoice/order/payment text visible in the saved source document. This re-analyzes evidence only; it does not receive stock, approve payment, or create AP without apply."
                              />
                              <button className="rounded-md bg-ink px-2 py-1 text-xs font-medium text-white">Save Text & Analyze</button>
                            </RefreshingActionForm>
                          </details>
                          {canDeleteSourceDocument ? (
                            <RefreshingActionForm
                              action={deleteAccountingDocumentAction}
                              className="text-xs text-slate-600"
                              confirmMessage="Delete this accounting source document? This permanently removes the saved file and analysis row. Applied or attached evidence cannot be deleted."
                            >
                              <input type="hidden" name="documentId" value={document.id} />
                              <button className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50">Delete Source Document</button>
                              <div className="mt-1 text-[11px] text-slate-500">This permanently removes the saved file and analysis row. It is only available before the document is attached or applied.</div>
                            </RefreshingActionForm>
                          ) : null}
                        </div>
                      ) : canApplyDocuments ? (
                        <div className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500">Linked Evidence Is Locked After Attach/Apply; upload a corrected source document instead of mutating the reviewed record.</div>
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
          <h2 className="font-medium">Uninvoiced Purchase Orders</h2>
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
                <Link href="/accounting/invoices" className="rounded-md border border-slate-300 px-3 py-2 text-xs hover:bg-slate-50">Create Invoice Manually</Link>
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <details className="rounded-lg border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-900">Canadian GST/HST and Audit-Ready Records</summary>
          <div className="mt-3 grid gap-3 text-sm text-slate-700">
            <Checklist title="Source Evidence" items={["Original PDF/email/screenshot stored privately", "SHA-256 hash and upload actor", "OCR/extraction text retained separately", "Human corrections create audit history"]} />
            <Checklist title="AP Invoice Fields" items={["Supplier legal name, invoice number/date/due date", "Currency, subtotal, shipping, tax, total", "Line quantities, SKU/part, unit price, tax treatment", "PO/receiving/customs/payment references"]} />
            <Checklist title="Tax And Landed Cost" items={["GST/HST ITC evidence and supplier tax number when required", "Recoverable tax separated from landed cost", "Duties, brokerage, freight, and non-recoverable tax tracked", "Currency/FX source preserved"]} />
            <Checklist title="Retention And Controls" items={["Keep supporting records for at least six years", "Deduplicate by hash, order, and supplier invoice key", "No payment without reference evidence", "No stock movement from accounting upload"]} />
          </div>
        </details>

        <details className="rounded-lg border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-900">Invoice Functionality Upgrades Active Here</summary>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            <li><span className="font-medium">Evidence Bundle:</span> multiple source documents attach to the same supplier invoice/PO with hash/path provenance.</li>
            <li><span className="font-medium">Order-Unique Bills:</span> supplier bills merge into the existing order invoice when another source points at the same PO/order.</li>
            <li><span className="font-medium">Customer Invoices / AR:</span> draft, send, and mark customer-facing invoices paid without consuming stock or shipping products.</li>
            <li><span className="font-medium">Payment Reconciliation:</span> bank transactions are deduped by hash and explicitly allocated to approved invoices before marking paid.</li>
            <li><span className="font-medium">GST/HST Exports:</span> accountant CSV rows separate recoverable and non-recoverable tax with source-evidence warnings.</li>
            <li><span className="font-medium">Posted Journals:</span> approving AP invoices and reconciling AP payments creates immutable, balanced journal entries with account snapshots.</li>
            <li><span className="font-medium">Automatic Extraction:</span> PDFs, emails, text, and screenshot OCR are analyzed into invoice/order/payment fields.</li>
            <li><span className="font-medium">Review Gates:</span> uncertain or non-invoice documents stay in review instead of posting AP.</li>
            <li><span className="font-medium">3-Way Boundary:</span> invoices can link to POs, but receiving remains on the `/incoming` workbench.</li>
            <li><span className="font-medium">Audit Trail:</span> upload/apply/reconcile actions are logged and source documents are immutable/deduped.</li>
          </ul>
        </details>

        <details className="rounded-lg border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-900">Accounting Control Trail</summary>
          <p className="mt-3 text-xs text-slate-500">Upload → Review → Apply/Attach → Approve/Pay → Post/Export</p>
          <ol className="mt-3 space-y-2 text-sm text-slate-700">
            <li><span className="font-medium">1. Capture Evidence:</span> private source file, hash, OCR/text, and upload actor.</li>
            <li><span className="font-medium">2. Triage Exceptions:</span> warnings stay visible until a human resolves or attaches them.</li>
            <li><span className="font-medium">3. Act Explicitly:</span> AP, approval, payment, and journals remain separate human-gated steps.</li>
          </ol>
        </details>
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

function MiniMetric({ href, label, value, text, tone }: { href?: string; label: string; value: string; text: string; tone: string }) {
  const className = `block rounded-md border p-3 ${miniMetricToneClass(tone)} ${href ? "hover:ring-2 hover:ring-blue-100" : ""}`;
  const body = (
    <>
      <div className="text-xs font-medium uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs opacity-80">{text}</div>
      {href ? <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide opacity-70">Open →</div> : null}
    </>
  );
  return href ? <Link href={href} className={className}>{body}</Link> : <div className={className}>{body}</div>;
}

function CommandMetric({ title, value, detail, tone }: { title: string; value: string; detail: string; tone: string }) {
  return (
    <div className={`rounded-md border p-3 ${miniMetricToneClass(tone)}`}>
      <div className="text-xs font-medium uppercase tracking-wide">{title}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      <div className="mt-1 text-xs opacity-80">{detail}</div>
    </div>
  );
}

function urgencyClass(urgency: "overdue" | "due-soon" | "later" | "no-due-date") {
  if (urgency === "overdue") return "border-amber-200 bg-amber-50 text-amber-800";
  if (urgency === "due-soon") return "border-blue-200 bg-blue-50 text-blue-800";
  if (urgency === "no-due-date") return "border-slate-200 bg-slate-50 text-slate-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function workflowStepClass(tone: string, active: boolean) {
  const base = "flex h-full gap-3 rounded-lg border p-3 transition hover:-translate-y-0.5 hover:shadow-sm";
  const toneClass = miniMetricToneClass(tone);
  const emphasis = active ? "ring-2 ring-blue-200 shadow-sm" : tone === "slate" ? "opacity-75" : "";
  return `${base} ${toneClass} ${emphasis}`;
}

function workflowStepNumberClass(tone: string) {
  const base = "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 ring-inset ring-current";
  if (tone === "emerald") return `${base} bg-emerald-100 text-emerald-800`;
  if (tone === "amber") return `${base} bg-amber-100 text-amber-800`;
  if (tone === "blue") return `${base} bg-blue-100 text-blue-800`;
  return `${base} bg-slate-100 text-slate-700`;
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
    <a href={href} data-testid={`accounting-link-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`} className="block h-full rounded-md border border-slate-200 bg-white p-4 hover:border-slate-300 hover:bg-slate-50">
      <div className="text-sm font-medium text-slate-900">{title}</div>
      <div className="mt-1 text-xs text-slate-500">{text}</div>
    </a>
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
