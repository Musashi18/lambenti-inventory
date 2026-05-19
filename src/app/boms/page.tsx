import { getBomExplosion } from "@/modules/boms/service";

export const dynamic = "force-dynamic";

export default async function BomsPage() {
  const boms = await getBomExplosion();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">BOM explosion view</h1>
        <p className="text-sm text-slate-600">Finished goods expanded into component demand.</p>
      </div>
      {boms.map((bom) => (
        <section key={bom.id} className="rounded-md border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-medium">
              {bom.parentItem.sku} - {bom.version}
            </h2>
          </div>
          <div className="space-y-2 text-sm">
            {bom.lines.map((line) => (
              <div key={line.id} className="flex justify-between border-t border-slate-100 pt-2">
                <span>{line.componentItem.sku}</span>
                <span>{line.quantity} per unit</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
