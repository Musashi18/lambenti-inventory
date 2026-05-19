import { logAgentAction } from "@/modules/agents/service";
import { getSupplierComparison } from "@/modules/suppliers/service";

export async function GET() {
  const result = await getSupplierComparison();
  await logAgentAction("COMPARE_SUPPLIERS", {}, result);
  return Response.json(result);
}

