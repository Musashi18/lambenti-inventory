import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAgentRequest } from "@/modules/auth/permissions";
import { getTrackingRefreshHeartbeat, refreshActiveTrackingNumbers, refreshDueTrackingNumbers, refreshTrackingNumber } from "@/modules/tracking/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  trackingNumber: z.string().optional(),
  dueOnly: z.boolean().optional(),
  limit: z.number().int().positive().max(100).optional(),
  actorId: z.string().optional()
}).optional();

export async function POST(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof bodySchema> = {};
  try {
    body = bodySchema.parse(await request.json().catch(() => ({}))) ?? {};
  } catch (error) {
    return NextResponse.json({ error: "Invalid tracking refresh payload", details: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  const actorId = auth.actorId;
  if (body.trackingNumber) {
    const tracking = await refreshTrackingNumber({ trackingNumber: body.trackingNumber, actorId });
    const heartbeat = await getTrackingRefreshHeartbeat();
    return NextResponse.json({ refreshed: tracking.refreshStatus === "SUCCESS" ? 1 : 0, failed: tracking.refreshStatus === "FAILED" ? 1 : 0, tracking, heartbeat });
  }

  const result = body.dueOnly === true
    ? await refreshDueTrackingNumbers({ actorId, limit: body.limit ?? 25 })
    : await refreshActiveTrackingNumbers({ actorId, limit: body.limit ?? 100 });
  const heartbeat = await getTrackingRefreshHeartbeat();
  return NextResponse.json({ ...result, heartbeat }, { status: result.failed > 0 && result.refreshed === 0 ? 207 : 200 });
}

function authorize(request: NextRequest): { ok: true; actorId: string } | { ok: false; response: NextResponse } {
  const localAuth = authorizeAgentRequest(request, {
    nodeEnv: process.env.NODE_ENV,
    agentSecret: undefined,
    allowLocalProductionAuth: process.env.LAMBENTI_ALLOW_LOCAL_PROD_AUTH
  });
  if (localAuth.ok) return { ok: true, actorId: localAuth.actor.id };

  const auth = authorizeAgentRequest(request, {
    nodeEnv: process.env.NODE_ENV,
    agentSecret: process.env.LAMBENTI_TRACKING_AGENT_SECRET ?? process.env.LAMBENTI_ALIBABA_AGENT_SECRET ?? process.env.LAMBENTI_EMAIL_SYNC_SECRET,
    allowLocalProductionAuth: process.env.LAMBENTI_ALLOW_LOCAL_PROD_AUTH
  });
  if (auth.ok) return { ok: true, actorId: auth.actor.id };
  return { ok: false, response: NextResponse.json({ error: auth.message }, { status: auth.status }) };
}
