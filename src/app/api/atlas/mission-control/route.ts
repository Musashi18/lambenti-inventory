import { NextResponse } from "next/server";
import { requirePermission } from "@/modules/auth/permissions";
import { buildAtlasMissionControlView } from "@/modules/atlas/presentation";
import { getAtlasMissionControl } from "@/modules/atlas/service";

export const dynamic = "force-dynamic";

export async function GET() {
  await requirePermission("atlas:view");
  const atlas = await getAtlasMissionControl();
  return NextResponse.json(buildAtlasMissionControlView(atlas), {
    headers: {
      "Cache-Control": "private, no-store"
    }
  });
}
