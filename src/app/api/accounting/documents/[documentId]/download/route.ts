import { readFile } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/modules/auth/permissions";
import { accountingDocumentRoot } from "@/modules/documents/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  await requirePermission("accounting:view");
  const { documentId } = await context.params;
  const document = await prisma.accountingDocument.findUniqueOrThrow({ where: { id: documentId } });
  const absolutePath = resolve(process.cwd(), document.storedPath);
  const root = resolve(accountingDocumentRoot());
  const relativeToRoot = relative(root, absolutePath);
  if (relativeToRoot.startsWith("..") || relativeToRoot === ".." || relativeToRoot.includes(`..${sep}`)) {
    return NextResponse.json({ error: "Accounting document path is outside the configured storage root." }, { status: 403 });
  }

  const buffer = await readFile(absolutePath);
  return new Response(buffer, {
    headers: {
      "content-type": document.mimeType,
      "content-length": String(buffer.length),
      "content-disposition": `attachment; filename="${downloadFileName(document.originalFileName)}"`,
      "cache-control": "private, no-store"
    }
  });
}

function downloadFileName(fileName: string) {
  return basename(fileName).replace(/["\r\n]/g, "_");
}
