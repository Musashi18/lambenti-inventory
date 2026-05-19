import { logAgentAction } from "@/modules/agents/service";
import { getStockSummaries } from "@/modules/inventory/service";

export async function GET() {
  const result = await getStockSummaries();
  await logAgentAction("READ_STOCK", {}, result);
  return Response.json(result);
}

