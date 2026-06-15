import { formatLandedCostCsv, getLandedCostRows } from "@/modules/accounting/landed-cost";
import { requirePermission } from "@/modules/auth/permissions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await requirePermission("accounting:view");
  const url = new URL(request.url);
  const rows = await getLandedCostRows({
    from: parseDate(url.searchParams.get("from") ?? undefined),
    to: parseDate(url.searchParams.get("to") ?? undefined, true)
  });
  return new Response(formatLandedCostCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=lambenti-landed-cost-export.csv"
    }
  });
}

function parseDate(value?: string, endOfDay = false) {
  if (!value) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
