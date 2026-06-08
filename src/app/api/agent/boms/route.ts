import { getBomExplosion } from "@/modules/boms/service";
import { logAgentAction } from "@/modules/agents/service";
import { authFailureJson, authorizeAgentRequest } from "@/modules/auth/permissions";

export async function GET(request: Request) {
  const auth = authorizeAgentRequest(request);
  if (!auth.ok) return authFailureJson(auth);

  const result = await getBomExplosion();
  await logAgentAction("READ_BOM", { actorId: auth.actor.id }, result);
  return Response.json(result);
}

