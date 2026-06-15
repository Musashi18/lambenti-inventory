import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { importAlibabaPortalSnapshots } from "@/modules/alibaba-portal/import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const invoiceDocumentSchema = z.object({
  fileName: z.string().optional(),
  localPath: z.string().optional(),
  sourceUrl: z.string().optional(),
  sha256: z.string().optional(),
  text: z.string().optional(),
  downloadedAt: z.string().optional()
});

const snapshotSchema = z.object({
  sourceUrl: z.string().min(1),
  pageTitle: z.string().optional(),
  capturedAt: z.string().optional(),
  subject: z.string().optional(),
  messageId: z.string().optional(),
  orderId: z.string().optional(),
  orderStatus: z.string().optional(),
  orderDate: z.string().optional(),
  supplierName: z.string().optional(),
  trackingNumbers: z.array(z.string()).optional(),
  conversationContext: z.string().optional(),
  text: z.string().min(20),
  invoiceDocuments: z.array(invoiceDocumentSchema).optional()
});

const bodySchema = z.object({
  snapshots: z.array(snapshotSchema).min(1).max(200),
  autoApply: z.boolean().optional(),
  autoCreateInvoices: z.boolean().optional(),
  actorId: z.string().optional()
});

export async function POST(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid Alibaba portal import payload", details: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }

  const result = await importAlibabaPortalSnapshots({
    snapshots: body.snapshots,
    actorId: auth.actorId,
    autoApply: body.autoApply ?? true,
    autoCreateInvoices: body.autoCreateInvoices ?? true
  });

  return NextResponse.json(result, { status: result.errors.length > 0 ? 207 : 200 });
}

function authorize(request: NextRequest): { ok: true; actorId: string } | { ok: false; response: NextResponse } {
  const secret = process.env.LAMBENTI_ALIBABA_AGENT_SECRET ?? process.env.LAMBENTI_EMAIL_SYNC_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, response: NextResponse.json({ error: "Alibaba portal import secret is not configured for production." }, { status: 503 }) };
    }
    return { ok: true, actorId: request.headers.get("x-lambenti-agent-id") ?? "local-alibaba-portal-agent" };
  }

  const header = request.headers.get("authorization");
  const headerSecret = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

  if (headerSecret === secret) {
    return { ok: true, actorId: request.headers.get("x-lambenti-agent-id") ?? "alibaba-portal-agent" };
  }

  return { ok: false, response: NextResponse.json({ error: "Unauthorized Alibaba portal import request" }, { status: 401 }) };
}
