import { ItemCategory, LifecycleStatus, Unit } from "@prisma/client";
import { DashboardTable } from "@/components/dashboard-table";
import { prisma } from "@/lib/prisma";
import { getItems } from "@/modules/items/service";
import { createItemAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ItemsPage() {
  const [items, suppliers] = await Promise.all([
    getItems(),
    prisma.supplier.findMany({ orderBy: { name: "asc" } })
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Inventory items</h1>
        <p className="text-sm text-slate-600">Create and maintain stock master data.</p>
      </div>

      <section className="rounded-md border border-slate-200 bg-white p-4">
        <h2 className="mb-4 font-medium">Add item</h2>
        <form action={createItemAction} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <input name="sku" placeholder="Internal SKU" className="rounded-md border px-3 py-2" required />
          <input name="manufacturerPartNo" placeholder="Manufacturer part no." className="rounded-md border px-3 py-2" />
          <input name="supplierSku" placeholder="Supplier SKU" className="rounded-md border px-3 py-2" />
          <input name="description" placeholder="Description" className="rounded-md border px-3 py-2" required />
          <select name="category" className="rounded-md border px-3 py-2" defaultValue={ItemCategory.COMPONENT}>
            {Object.values(ItemCategory).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select name="unit" className="rounded-md border px-3 py-2" defaultValue={Unit.EACH}>
            {Object.values(Unit).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <input name="reorderPoint" type="number" placeholder="Reorder point" className="rounded-md border px-3 py-2" required />
          <input name="targetStock" type="number" placeholder="Target stock" className="rounded-md border px-3 py-2" required />
          <input name="leadTimeDays" type="number" placeholder="Lead time days" className="rounded-md border px-3 py-2" required />
          <select name="preferredSupplierId" className="rounded-md border px-3 py-2" defaultValue="">
            <option value="">No preferred supplier</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
          <select name="lifecycleStatus" className="rounded-md border px-3 py-2" defaultValue={LifecycleStatus.ACTIVE}>
            {Object.values(LifecycleStatus).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <input name="storageLocation" placeholder="Storage location" className="rounded-md border px-3 py-2" required />
          <button className="rounded-md bg-ink px-4 py-2 text-white xl:col-span-4">Create item</button>
        </form>
      </section>

      <DashboardTable
        title="Item catalog"
        columns={["SKU", "Description", "Category", "Preferred supplier", "Location"]}
        rows={items.map((item) => [
          item.sku,
          item.description,
          item.category,
          item.preferredSupplier?.name ?? "None",
          item.storageLocation
        ])}
      />
    </div>
  );
}
