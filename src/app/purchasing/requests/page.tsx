import { prisma } from "@/lib/prisma";
import { RefreshingActionForm } from "@/app/refreshing-action-form";
import { requirePermission } from "@/modules/auth/permissions";
import {
  approvePurchaseRequestAction,
  convertApprovedPurchaseRequestAction,
  rejectPurchaseRequestAction
} from "./actions";

export const dynamic = "force-dynamic";

export default async function PurchaseRequestsPage() {
  await requirePermission("purchaseRequest:draft");
  const requests = await prisma.purchaseRequest.findMany({
    include: {
      supplier: true,
      purchaseOrder: true,
      lines: {
        include: {
          item: true
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Purchase request approvals</h1>
        <p className="text-sm text-slate-600">
          Human approval gate for agent or user-generated purchasing requests.
        </p>
      </div>

      <div className="space-y-4">
        {requests.map((request) => (
          <section key={request.id} className="rounded-md border border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="font-medium">{request.status}</div>
                <div className="text-sm text-slate-600">{request.rationale}</div>
                <div className="mt-2 text-sm">
                  Supplier: {request.supplier?.name ?? "Unassigned"}
                </div>
                <div className="mt-2 space-y-1 text-sm">
                  {request.lines.map((line) => {
                    const unitPriceEvidence = line.targetUnitPrice ?? line.item.estimatedUnitCost;
                    return (
                      <div key={line.id}>
                        {line.item.sku} x {line.quantity}
                        <span className="ml-2 text-xs text-slate-500">
                          {unitPriceEvidence
                            ? `Unit price evidence: $${Number(unitPriceEvidence).toFixed(4)} USD`
                            : "Missing unit price evidence"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              {request.status === "DRAFT" || request.status === "PENDING_APPROVAL" ? (
                <div className="flex gap-2">
                  <RefreshingActionForm action={approvePurchaseRequestAction}>
                    <input type="hidden" name="requestId" value={request.id} />
                    <button className="rounded-md bg-mint px-3 py-2 text-sm text-white">Approve</button>
                  </RefreshingActionForm>
                  <RefreshingActionForm action={rejectPurchaseRequestAction}>
                    <input type="hidden" name="requestId" value={request.id} />
                    <button className="rounded-md bg-coral px-3 py-2 text-sm text-white">Reject</button>
                  </RefreshingActionForm>
                </div>
              ) : null}
              {request.status === "APPROVED" ? (
                <RefreshingActionForm action={convertApprovedPurchaseRequestAction} className="flex flex-col items-start gap-2">
                  <input type="hidden" name="requestId" value={request.id} />
                  <input type="hidden" name="comment" value="Converted from approved purchase request by purchasing approvals page." />
                  <button className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white">Create draft PO</button>
                  <div className="max-w-64 text-xs text-slate-500">Creates a draft purchase order only; inventory is still received separately through Incoming.</div>
                </RefreshingActionForm>
              ) : null}
              {request.purchaseOrder ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  Draft PO linked: {request.purchaseOrder.id}
                </div>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
