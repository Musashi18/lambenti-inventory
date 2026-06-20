import { getIncomingOrders } from "@/modules/purchasing/service";
import { requirePermission } from "@/modules/auth/permissions";
import { ReceiveIncomingLineForm } from "./receive-line-form";

export const dynamic = "force-dynamic";

export default async function IncomingPage() {
  await requirePermission("receiving:confirm");
  const orders = await getIncomingOrders();
  const defaultReceivedAt = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Incoming / Receiving</h1>
        <p className="text-sm text-slate-600">
          Open purchase orders waiting for physical receipt. Confirm stock only after a human count; this writes an immutable RECEIVE ledger entry, links it to the PO line, and updates received quantities. Email imports and invoices do not receive stock.
        </p>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-500">
          No ordered or partially received purchase orders are waiting for receipt.
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => {
            const duplicateLineGroups = groupDuplicateIncomingLines(order.lines);
            const progress = summarizeReceivingProgress(order.lines);
            return (
            <article key={order.id} className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-2 border-b border-slate-200 p-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-lg font-medium text-slate-900">{order.supplier.name}</h2>
                  <p className="text-sm text-slate-500">
                    PO {order.id.slice(-8).toUpperCase()} · {order.status} · Expected {order.expectedAt?.toISOString().slice(0, 10) ?? "TBD"}
                  </p>
                </div>
                <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                  {order.lines.length} line{order.lines.length === 1 ? "" : "s"}
                </div>
              </div>

              <div className="border-b border-slate-100 px-4 py-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                  <span className="font-semibold uppercase tracking-wide">Receiving Progress</span>
                  <span>{progress.receivedQuantity} / {progress.orderedQuantity} Received · {progress.remainingQuantity} Remaining</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100" aria-label="Purchase order receiving progress">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-500" style={{ width: `${progress.percent}%` }} />
                </div>
              </div>

              {duplicateLineGroups.length > 0 ? (
                <div className="border-b border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                  <div className="font-medium">Packing Slip Duplicate Check</div>
                  <p className="mt-1">These SKUs appear multiple times on this PO. Receive each source line only after human count, but use this summary to batch-check the packing slip before entering counts.</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {duplicateLineGroups.map((group) => (
                      <li key={group.sku}>{group.sku}: {group.lineCount} lines · ordered {group.orderedQuantity} · remaining {group.remainingQuantity}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="divide-y divide-slate-100">
                {order.lines.map((line) => {
                  const remainingQuantity = Math.max(line.quantity - line.receivedQuantity, 0);
                  const defaultReference = `PO-${order.id.slice(-8).toUpperCase()}-${line.item.sku}`;
                  return (
                    <div key={line.id} className="p-4">
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                        <div>
                          <div className="text-sm font-medium text-slate-900">{line.item.sku}</div>
                          <div className="text-sm text-slate-600">{line.item.description}</div>
                          <div className="mt-2 grid gap-2 text-sm text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
                            <Metric label="Ordered" value={line.quantity.toString()} />
                            <Metric label="Received" value={line.receivedQuantity.toString()} />
                            <Metric label="Remaining Quantity" value={remainingQuantity.toString()} />
                            <Metric label="Unit Price" value={`${line.item.costCurrency || "USD"} ${line.unitPrice.toString()}`} />
                          </div>
                        </div>
                        {remainingQuantity === 0 ? (
                          <span className="rounded-full bg-mint/10 px-3 py-1 text-xs font-medium text-emerald-800">Fully received</span>
                        ) : (
                          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">Awaiting human count</span>
                        )}
                      </div>

                      {remainingQuantity > 0 ? (
                        <ReceiveIncomingLineForm
                          purchaseOrderLineId={line.id}
                          remainingQuantity={remainingQuantity}
                          defaultUnitCost={line.unitPrice.toString()}
                          defaultCurrency={line.item.costCurrency || "USD"}
                          defaultReceivedAt={defaultReceivedAt}
                          defaultReference={defaultReference}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

type IncomingLine = Awaited<ReturnType<typeof getIncomingOrders>>[number]["lines"][number];

function summarizeReceivingProgress(lines: IncomingLine[]) {
  const orderedQuantity = lines.reduce((total, line) => total + line.quantity, 0);
  const receivedQuantity = lines.reduce((total, line) => total + line.receivedQuantity, 0);
  const remainingQuantity = Math.max(orderedQuantity - receivedQuantity, 0);
  const percent = orderedQuantity > 0 ? Math.min(100, Math.round((receivedQuantity / orderedQuantity) * 100)) : 0;
  return { orderedQuantity, receivedQuantity, remainingQuantity, percent };
}

function groupDuplicateIncomingLines(lines: IncomingLine[]) {
  const groups = new Map<string, { sku: string; lineCount: number; orderedQuantity: number; remainingQuantity: number }>();
  for (const line of lines) {
    const current = groups.get(line.item.sku) ?? { sku: line.item.sku, lineCount: 0, orderedQuantity: 0, remainingQuantity: 0 };
    current.lineCount += 1;
    current.orderedQuantity += line.quantity;
    current.remainingQuantity += Math.max(line.quantity - line.receivedQuantity, 0);
    groups.set(line.item.sku, current);
  }
  return Array.from(groups.values()).filter((group) => group.lineCount > 1);
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="font-medium text-slate-900">{value}</div>
    </div>
  );
}
