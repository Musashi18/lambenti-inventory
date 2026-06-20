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
        <h1 className="text-2xl font-semibold">Stock Movement History</h1>
        <p className="text-sm text-slate-600">
          Immutable item-level ledger of inventory changes. Lot controls are hidden for now. The Delete button hides the row from this operator list and writes a compensating reversal row instead of hard-deleting audit history. Recent rows include the item balance after each visible ledger entry so stock drift is easier to audit.
        </p>
      </div>

      <section className="rounded-md border border-slate-200 bg-white p-4">
        <h2 className="mb-4 font-medium">Record Item Movement</h2>
        <MovementForm items={formItems} buildableItemIds={buildableItemIds} />
      </section>

      <section className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600">
        <h2 className="font-medium text-slate-900">Ledger Reading Guide</h2>
        <p className="mt-1">Signed impact colors show inventory direction; sticky SKU context keeps the item visible while auditing wide ledger rows. No charting is added to the immutable movement table.</p>
      </section>

      <section className="rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="font-medium">Recent Stock Movements</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Entry Time</th>
                <th className="sticky left-0 z-10 bg-slate-50 px-4 py-3">SKU</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Quantity</th>
                <th className="px-4 py-3">Ledger Impact</th>
                <th className="px-4 py-3">Balance After Entry</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {movements.length === 0 ? (
                <tr><td className="px-4 py-6 text-slate-500" colSpan={9}>No visible stock movements yet.</td></tr>
              ) : movements.map((movement) => {
                const deleteDisabled = movement.movementType === MovementType.RESERVE;
                return (
                  <tr key={movement.id} className="table-row-interactive">
                    <td className="whitespace-nowrap px-4 py-3">{movement.createdAt.toLocaleString("en-CA", { hour12: false })}</td>
                    <td className="table-sticky-cell sticky left-0 z-10 px-4 py-3 font-medium">{movement.item.sku}</td>
                    <td className="px-4 py-3">{movement.movementType}</td>
                    <td className="px-4 py-3">{movement.quantity}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${ledgerImpactClass(movement.signedQuantity, movement.movementType)}`}>
                        {formatLedgerImpact(movement.movementType, movement.quantity, movement.signedQuantity)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <div className="font-medium text-slate-800">On Hand {movement.balanceAfter.onHand}</div>
                      <div>Available {movement.balanceAfter.available} · Reserved {movement.balanceAfter.reserved}</div>
                    </td>
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

function ledgerImpactClass(signedQuantity: number, movementType: MovementType) {
  if (movementType === MovementType.RESERVE) return "border-blue-200 bg-blue-50 text-blue-800";
  if (signedQuantity < 0) return "border-red-200 bg-red-50 text-red-800";
  if (signedQuantity > 0) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function formatLedgerImpact(movementType: MovementType, quantity: number, signedQuantity: number) {
  if (movementType === MovementType.RESERVE) {
    return `Reserve ${quantity}`;
  }
  if (signedQuantity > 0) {
    return `+${signedQuantity}`;
  }
  return signedQuantity.toString();
}
