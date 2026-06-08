import { prisma } from "@/lib/prisma";
import { RefreshingActionForm } from "@/app/refreshing-action-form";
import { requirePermission } from "@/modules/auth/permissions";
import {
  approvePurchaseRequestAction,
  rejectPurchaseRequestAction
} from "./actions";

export const dynamic = "force-dynamic";

export default async function PurchaseRequestsPage() {
  await requirePermission("purchaseRequest:draft");
  const requests = await prisma.purchaseRequest.findMany({
    include: {
      supplier: true,
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
                  {request.lines.map((line) => (
                    <div key={line.id}>
                      {line.item.sku} x {line.quantity}
                    </div>
                  ))}
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
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
