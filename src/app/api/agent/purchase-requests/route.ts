import { z } from "zod";
import { logAgentAction } from "@/modules/agents/service";
import { createDraftPurchaseRequest } from "@/modules/purchasing/service";

const schema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().positive(),
  rationale: z.string().min(1),
  requestedBy: z.string().min(1),
  supplierId: z.string().optional()
});

export async function POST(request: Request) {
  const payload = schema.parse(await request.json());
  const result = await createDraftPurchaseRequest({
    ...payload,
    actorType: "AGENT",
    actorId: payload.requestedBy
  });
  await logAgentAction("CREATE_DRAFT_PURCHASE_REQUEST", payload, result);
  return Response.json(result, { status: 201 });
}

