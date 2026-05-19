import { MovementType } from "@prisma/client";
import { DashboardTable } from "@/components/dashboard-table";
import { prisma } from "@/lib/prisma";
import { createMovementAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function MovementsPage() {
  const [items, movements] = await Promise.all([
    prisma.item.findMany({ orderBy: { sku: "asc" } }),
    prisma.stockMovement.findMany({
      include: { item: true },
      orderBy: { createdAt: "desc" },
      take: 25
    })
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Stock movement history</h1>
        <p className="text-sm text-slate-600">Immutable ledger of inventory changes.</p>
      </div>

      <section className="rounded-md border border-slate-200 bg-white p-4">
        <h2 className="mb-4 font-medium">Record movement</h2>
        <form action={createMovementAction} className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <select name="itemId" className="rounded-md border px-3 py-2">
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.sku}
              </option>
            ))}
          </select>
          <select name="movementType" className="rounded-md border px-3 py-2" defaultValue={MovementType.RECEIVE}>
            {Object.values(MovementType).map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
          <input name="quantity" type="number" placeholder="Quantity" className="rounded-md border px-3 py-2" required />
          <input name="reason" placeholder="Reason" className="rounded-md border px-3 py-2" required />
          <input name="reference" placeholder="Reference" className="rounded-md border px-3 py-2" />
          <button className="rounded-md bg-ink px-4 py-2 text-white xl:col-span-5">Record movement</button>
        </form>
      </section>

      <DashboardTable
        title="Recent stock movements"
        columns={["Date", "SKU", "Type", "Quantity", "Reason"]}
        rows={movements.map((movement) => [
          movement.createdAt.toISOString().slice(0, 10),
          movement.item.sku,
          movement.movementType,
          movement.quantity.toString(),
          movement.reason
        ])}
      />
    </div>
  );
}
