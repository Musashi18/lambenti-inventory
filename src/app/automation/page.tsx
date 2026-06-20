import Link from "next/link";
import { AuthorizationError, hasPermission, requirePermission } from "@/modules/auth/permissions";
import { getAutomationOverview } from "@/modules/automation/service";
import { createDraftPurchaseRequestFromFindingAction, runInventoryAnomalyScanAction, runStockReorderScanAction, ignoreAutomationFindingAction } from "./actions";
import { AutomationScanControls } from "./automation-scan-controls";
import { RefreshingActionForm } from "@/app/refreshing-action-form";

export const dynamic = "force-dynamic";

function formatDate(date: Date | null) {
  return date ? new Intl.DateTimeFormat("en", { dateStyle: "short", timeStyle: "short" }).format(date) : "—";
}

export default async function AutomationPage() {
  const auth = await resolveAutomationViewer();
  if (!auth.ok) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <h1 className="text-lg font-semibold">Automation Requires Authenticated Access</h1>
        <p className="mt-2">{auth.message}</p>
        <p className="mt-2">No automation data was loaded and no scanner actions are available. Configure production auth or use the safe local development identity.</p>
      </div>
    );
  }

  const overview = await getAutomationOverview();
  const canRunAutomation = hasPermission(auth.actor, "automation:run");
  const canDraftPurchaseRequests = hasPermission(auth.actor, "purchaseRequest:draft");
  const openFindings = [...overview.openFindings].sort((left, right) => severityRank(left.severity) - severityRank(right.severity) || left.createdAt.getTime() - right.createdAt.getTime());
  const severityGroups = groupFindingsBySeverity(openFindings);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Automation Control Center</h1>
        <p className="text-sm text-slate-600">
          Run safe, idempotent analysis. Automation writes runs and findings for human review, but it never receives stock, approves purchases, or pays invoices.
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Open findings</div>
          <div className="mt-1 text-2xl font-semibold">{overview.openFindings.length}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Recent runs</div>
          <div className="mt-1 text-2xl font-semibold">{overview.recentRuns.length}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Failed runs</div>
          <div className="mt-1 text-2xl font-semibold">{overview.failedRuns.length}</div>
        </div>
      </section>

      <section className="rounded-md border border-slate-200 bg-white p-4">
        <h2 className="font-medium">Manual Safe Automation</h2>
        <p className="mt-1 text-sm text-slate-600">These actions only analyze source-of-truth data and create review findings.</p>
        {canRunAutomation ? (
          <AutomationScanControls
            runStockReorderScanAction={runStockReorderScanAction}
            runInventoryAnomalyScanAction={runInventoryAnomalyScanAction}
          />
        ) : (
          <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            Your role can view automation runs and findings, but cannot start scans.
          </p>
        )}
      </section>

      <section className="rounded-md border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-medium">Severity Grouping</h2>
            <p className="text-xs text-slate-500">Review severe findings first before running more automation.</p>
          </div>
          <span className="rounded-full border border-slate-200 px-2 py-1 text-xs text-slate-600">{severityGroups.length} active group{severityGroups.length === 1 ? "" : "s"}</span>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          {severityGroups.length === 0 ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">No grouped findings.</div>
          ) : severityGroups.map((group) => (
            <div key={group.severity} className={`rounded-md border p-3 ${severityClass(group.severity)}`}>
              <div className="text-xs font-semibold uppercase tracking-wide">{group.severity}</div>
              <div className="mt-1 text-2xl font-semibold">{group.count}</div>
              <div className="mt-1 text-xs opacity-80">{group.primaryCategory}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="font-medium">Open Automation Findings</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Finding</th>
                <th className="px-4 py-3">Suggested Action</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {overview.openFindings.length === 0 ? (
                <tr><td className="px-4 py-6 text-slate-500" colSpan={6}>No open findings.</td></tr>
              ) : openFindings.map((finding) => (
                <tr key={finding.id}>
                  <td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${severityClass(finding.severity)}`}>{finding.severity}</span></td>
                  <td className="px-4 py-3">{finding.category}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{finding.title}</div>
                    <div className="text-slate-600">{finding.message}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>{finding.entityType} · {finding.entityId}</span>
                      <Link href={findingHref(finding)} className="font-medium text-ink underline underline-offset-4">
                        {findingLinkLabel(finding)}
                      </Link>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div>{finding.suggestedActionType ?? "Review"}</div>
                    {finding.suggestedActionType === "DRAFT_PURCHASE_REQUEST" && canDraftPurchaseRequests ? (
                      <RefreshingActionForm action={createDraftPurchaseRequestFromFindingAction} className="mt-2">
                        <input type="hidden" name="findingId" value={finding.id} />
                        <button className="rounded-md bg-ink px-2 py-1 text-xs font-medium text-white hover:opacity-90">
                          Create Draft PR
                        </button>
                      </RefreshingActionForm>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(finding.createdAt)}</td>
                  <td className="px-4 py-3">
                    {canRunAutomation ? (
                      <RefreshingActionForm action={ignoreAutomationFindingAction} confirmMessage="Dismiss this finding? Dismissed findings stay hidden for the same dedupe key until the underlying data changes.">
                        <input type="hidden" name="findingId" value={finding.id} />
                        <button className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                          Dismiss Finding
                        </button>
                      </RefreshingActionForm>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-md border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-medium">Severity Grouping</h2>
            <p className="text-xs text-slate-500">Review severe findings first before running more automation.</p>
          </div>
          <span className="rounded-full border border-slate-200 px-2 py-1 text-xs text-slate-600">{severityGroups.length} active group{severityGroups.length === 1 ? "" : "s"}</span>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          {severityGroups.length === 0 ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">No grouped findings.</div>
          ) : severityGroups.map((group) => (
            <div key={group.severity} className={`rounded-md border p-3 ${severityClass(group.severity)}`}>
              <div className="text-xs font-semibold uppercase tracking-wide">{group.severity}</div>
              <div className="mt-1 text-2xl font-semibold">{group.count}</div>
              <div className="mt-1 text-xs opacity-80">{group.primaryCategory}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="font-medium">Recent Automation Runs</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Kind</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">Finished</th>
                <th className="px-4 py-3">Findings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {overview.recentRuns.length === 0 ? (
                <tr><td className="px-4 py-6 text-slate-500" colSpan={6}>No automation runs yet.</td></tr>
              ) : overview.recentRuns.map((run) => (
                <tr key={run.id}>
                  <td className="px-4 py-3 font-medium">{run.kind}</td>
                  <td className="px-4 py-3">{run.status}</td>
                  <td className="px-4 py-3">{run.actorType}:{run.actorId}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(run.startedAt)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(run.finishedAt)}</td>
                  <td className="px-4 py-3">{run.findings.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function groupFindingsBySeverity(findings: Array<{ severity: string; category: string }>) {
  const groups = new Map<string, { severity: string; count: number; categories: Map<string, number> }>();
  for (const finding of findings) {
    const current = groups.get(finding.severity) ?? { severity: finding.severity, count: 0, categories: new Map<string, number>() };
    current.count += 1;
    current.categories.set(finding.category, (current.categories.get(finding.category) ?? 0) + 1);
    groups.set(finding.severity, current);
  }
  return Array.from(groups.values())
    .sort((left, right) => severityRank(left.severity) - severityRank(right.severity))
    .map((group) => ({
      severity: group.severity,
      count: group.count,
      primaryCategory: Array.from(group.categories.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? "Review"
    }));
}

function severityRank(severity: string) {
  const normalized = severity.toUpperCase();
  if (normalized === "CRITICAL") return 0;
  if (normalized === "HIGH") return 1;
  if (normalized === "MEDIUM") return 2;
  if (normalized === "LOW") return 3;
  if (normalized === "INFO") return 4;
  return 5;
}

function severityClass(severity: string) {
  const normalized = severity.toUpperCase();
  if (normalized === "CRITICAL" || normalized === "HIGH") return "border-red-200 bg-red-50 text-red-800";
  if (normalized === "MEDIUM") return "border-amber-200 bg-amber-50 text-amber-800";
  if (normalized === "LOW") return "border-blue-200 bg-blue-50 text-blue-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function findingHref(finding: { entityType: string; entityId: string }) {
  if (finding.entityType === "Item") return `/inventory/items?focus=${encodeURIComponent(finding.entityId)}`;
  if (finding.entityType === "EmailOrderImport") return "/integrations/email-import";
  if (finding.entityType === "SupplierInvoice") return "/accounting/invoices";
  if (finding.entityType === "PurchaseRequest") return "/purchasing/requests";
  return "/automation";
}

function findingLinkLabel(finding: { entityType: string }) {
  if (finding.entityType === "Item") return "Open item";
  if (finding.entityType === "EmailOrderImport") return "Open email import";
  if (finding.entityType === "SupplierInvoice") return "Open invoice";
  if (finding.entityType === "PurchaseRequest") return "Open purchase request";
  return "Open automation";
}

type AutomationAuthResult =
  | { ok: true; actor: Awaited<ReturnType<typeof requirePermission>> }
  | { ok: false; message: string };

async function resolveAutomationViewer(): Promise<AutomationAuthResult> {
  try {
    const actor = await requirePermission("automation:view");
    return { ok: true, actor };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}
