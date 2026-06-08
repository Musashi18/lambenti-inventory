import { MovementType } from "@prisma/client";
import { requirePermission } from "@/modules/auth/permissions";
import { MovementForm } from "./movement-form";
import { VoidMovementButton } from "./void-movement-button";
import { getMovementPageData } from "./data";

export const dynamic = "force-dynamic";

export default async function MovementsPage() {
  await requirePermission("item:view");
  const { formItems, buildableItemIds, movements } = await getMovementPageData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Stock movement history</h1>
        <p className="text-sm text-slate-600">
          Immutable item-level ledger of inventory changes. Lot controls are hidden for now. The Delete button hides the row from this operator list and writes a compensating reversal row instead of hard-deleting audit history.
        </p>
      </div>

      <section className="rounded-md border border-slate-200 bg-white p-4">
        <h2 className="mb-4 font-medium">Record item movement</h2>
        <MovementForm items={formItems} buildableItemIds={buildableItemIds} />
      </section>

      <section className="rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="font-medium">Recent stock movements</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Entry time</th>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Quantity</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {movements.length === 0 ? (
                <tr><td className="px-4 py-6 text-slate-500" colSpan={7}>No visible stock movements yet.</td></tr>
              ) : movements.map((movement) => {
                const deleteDisabled = movement.movementType === MovementType.RESERVE;
                return (
                  <tr key={movement.id}>
                    <td className="whitespace-nowrap px-4 py-3">{movement.createdAt.toLocaleString("en-CA", { hour12: false })}</td>
                    <td className="px-4 py-3 font-medium">{movement.item.sku}</td>
                    <td className="px-4 py-3">{movement.movementType}</td>
                    <td className="px-4 py-3">{movement.quantity}</td>
                    <td className="px-4 py-3">{movement.reason}</td>
                    <td className="px-4 py-3">{movement.reference ?? "—"}</td>
                    <td className="px-4 py-3">
                      <VoidMovementButton movementId={movement.id} disabled={deleteDisabled} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
