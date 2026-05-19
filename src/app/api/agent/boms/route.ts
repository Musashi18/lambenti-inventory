import { getBomExplosion } from "@/modules/boms/service";
import { logAgentAction } from "@/modules/agents/service";

export async function GET() {
  const result = await getBomExplosion();
  await logAgentAction("READ_BOM", {}, result);
  return Response.json(result);
}

