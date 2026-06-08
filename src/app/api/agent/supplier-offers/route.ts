import { logAgentAction } from "@/modules/agents/service";
import { getSupplierComparison } from "@/modules/suppliers/service";
import { authFailureJson, authorizeAgentRequest } from "@/modules/auth/permissions";

export async function GET(request: Request) {
  const auth = authorizeAgentRequest(request);
  if (!auth.ok) return authFailureJson(auth);

  const result = await getSupplierComparison();
  await logAgentAction("COMPARE_SUPPLIERS", { actorId: auth.actor.id }, result);
  return Response.json(result);
}

