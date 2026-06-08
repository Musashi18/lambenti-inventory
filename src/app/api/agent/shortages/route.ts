import { getDashboardSummary } from "@/modules/dashboard/service";
import { logAgentAction } from "@/modules/agents/service";
import { authFailureJson, authorizeAgentRequest } from "@/modules/auth/permissions";

export async function GET(request: Request) {
  const auth = authorizeAgentRequest(request);
  if (!auth.ok) return authFailureJson(auth);

  const summary = await getDashboardSummary();
  await logAgentAction("EVALUATE_SHORTAGE", { actorId: auth.actor.id }, summary.shortages);
  return Response.json(summary.shortages);
}

