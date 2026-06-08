import { NextRequest, NextResponse } from "next/server";
import { syncAlibabaMailboxWithBackoff } from "@/modules/email-imports/mailbox";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return handleSync(request);
}

export async function POST(request: NextRequest) {
  return handleSync(request);
}

async function handleSync(request: NextRequest) {
  const authError = authorize(request);
  if (authError) return authError;

  const result = await syncAlibabaMailboxWithBackoff("api-mailbox-sync");
  return NextResponse.json(result, { status: result.configured ? 200 : 503 });
}

function authorize(request: NextRequest) {
  const secret = process.env.LAMBENTI_EMAIL_SYNC_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Mailbox sync secret is not configured for production." }, { status: 503 });
    }
    return null;
  }

  const header = request.headers.get("authorization");
  const headerSecret = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

  if (headerSecret === secret) return null;

  return NextResponse.json({ error: "Unauthorized mailbox sync request" }, { status: 401 });
}
