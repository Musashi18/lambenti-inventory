import { formatJournalEntryCsv, getJournalDashboard } from "@/modules/accounting/journals";
import { requirePermission } from "@/modules/auth/permissions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await requirePermission("accounting:view");
  const url = new URL(request.url);
  const from = parseDate(url.searchParams.get("from") ?? undefined);
  const to = parseDate(url.searchParams.get("to") ?? undefined, true);
  const { entries } = await getJournalDashboard({ from, to });
  const csv = formatJournalEntryCsv(entries);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="lambenti-journal-entries-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "private, no-store"
    }
  });
}

function parseDate(value?: string, endOfDay = false) {
  if (!value) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
