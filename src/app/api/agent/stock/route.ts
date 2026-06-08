import { authorizeAgentRequest, authFailureJson } from "@/modules/auth/permissions";
import { logAgentAction } from "@/modules/agents/service";
import { getStockSummaries } from "@/modules/inventory/service";

export async function GET(request: Request) {
  const auth = authorizeAgentRequest(request);
  if (!auth.ok) return authFailureJson(auth);

  const result = await getStockSummaries();
  await logAgentAction("READ_STOCK", { actorId: auth.actor.id }, result);
  return Response.json(result);
}
