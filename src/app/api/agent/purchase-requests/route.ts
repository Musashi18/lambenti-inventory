import { z } from "zod";
import { logAgentAction } from "@/modules/agents/service";
import { createDraftPurchaseRequest } from "@/modules/purchasing/service";
import { authFailureJson, authorizeAgentRequest } from "@/modules/auth/permissions";

const schema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().positive(),
  rationale: z.string().min(1),
  requestedBy: z.string().min(1),
  supplierId: z.string().optional()
});

export async function POST(request: Request) {
  const auth = authorizeAgentRequest(request);
  if (!auth.ok) return authFailureJson(auth);

  const parsed = schema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return Response.json({
      error: "Invalid draft purchase request payload.",
      details: parsed.error.flatten()
    }, { status: 400 });
  }

  try {
    const result = await createDraftPurchaseRequest({
      ...parsed.data,
      actorType: "AGENT",
      actorId: auth.actor.id
    });
    await logAgentAction("CREATE_DRAFT_PURCHASE_REQUEST", { ...parsed.data, actorId: auth.actor.id }, result);
    return Response.json(result, { status: 201 });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Draft purchase request failed."
    }, { status: 400 });
  }
}

