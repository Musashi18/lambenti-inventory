import { getDashboardSummary } from "@/modules/dashboard/service";
import { logAgentAction } from "@/modules/agents/service";

export async function GET() {
  const summary = await getDashboardSummary();
  await logAgentAction("EVALUATE_SHORTAGE", {}, summary.shortages);
  return Response.json(summary.shortages);
}

