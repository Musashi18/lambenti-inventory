import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

export const ACCOUNTING_DOCUMENT_MAX_BYTES = Number(process.env.LAMBENTI_ACCOUNTING_DOCUMENT_MAX_BYTES || 15_000_000);

const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "message/rfc822",
  "text/plain",
  "text/html",
  "text/csv",
  "application/csv",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/tiff",
  "image/bmp"
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".eml": "message/rfc822",
  ".txt": "text/plain",
  ".html": "text/html",
  ".htm": "text/html",
  ".csv": "text/csv",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".bmp": "image/bmp"
};

export type StoredAccountingDocumentFile = {
  originalFileName: string;
  safeFileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storedPath: string;
  absolutePath: string;
};

export function accountingDocumentRoot() {
  return process.env.LAMBENTI_ACCOUNTING_DOCUMENT_DIR || join(process.cwd(), "var", "accounting-documents");
}

export function sanitizeFileName(fileName: string) {
  const trimmed = fileName.trim() || "accounting-document";
  const extension = extname(trimmed).toLowerCase();
  const stem = trimmed.slice(0, extension ? -extension.length : undefined)
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "accounting-document";
  return `${stem}${extension}`;
}

export function inferAccountingDocumentMimeType(fileName: string, providedType?: string | null) {
  const normalizedProvided = providedType?.split(";")[0]?.trim().toLowerCase();
  if (normalizedProvided && normalizedProvided !== "application/octet-stream") return normalizedProvided;
  return MIME_BY_EXTENSION[extname(fileName).toLowerCase()] ?? "application/octet-stream";
}

export function isSupportedAccountingDocumentFileName(fileName: string, providedType?: string | null) {
  const inferred = inferAccountingDocumentMimeType(fileName, providedType);
  const extensionSupported = Boolean(MIME_BY_EXTENSION[extname(fileName).toLowerCase()]);
  return SUPPORTED_MIME_TYPES.has(inferred) || extensionSupported;
}

export function assertSupportedAccountingDocumentFile(input: { originalFileName: string; mimeType: string; sizeBytes: number }) {
  if (input.sizeBytes <= 0) throw new Error("Accounting document is empty.");
  if (input.sizeBytes > ACCOUNTING_DOCUMENT_MAX_BYTES) {
    throw new Error(`Accounting document is too large. Limit is ${Math.round(ACCOUNTING_DOCUMENT_MAX_BYTES / 1_000_000)} MB.`);
  }

  if (!isSupportedAccountingDocumentFileName(input.originalFileName, input.mimeType)) {
    throw new Error("Unsupported accounting document type. Upload PDF, EML/email, text/HTML/CSV, or common image screenshots.");
  }
}

export async function saveAccountingDocumentFile(input: {
  originalFileName: string;
  mimeType?: string | null;
  buffer: Buffer;
  now?: Date;
}): Promise<StoredAccountingDocumentFile> {
  const mimeType = inferAccountingDocumentMimeType(input.originalFileName, input.mimeType);
  assertSupportedAccountingDocumentFile({ originalFileName: input.originalFileName, mimeType, sizeBytes: input.buffer.length });

  const sha256 = createHash("sha256").update(input.buffer).digest("hex");
  const safeFileName = sanitizeFileName(input.originalFileName);
  const datePrefix = (input.now ?? new Date()).toISOString().slice(0, 10);
  const absoluteDir = join(accountingDocumentRoot(), datePrefix);
  await mkdir(absoluteDir, { recursive: true });

  const absolutePath = join(absoluteDir, `${sha256.slice(0, 16)}-${safeFileName}`);
  await writeFile(absolutePath, input.buffer, { flag: "wx" }).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });

  return {
    originalFileName: input.originalFileName,
    safeFileName,
    mimeType,
    sizeBytes: input.buffer.length,
    sha256,
    absolutePath,
    storedPath: relative(process.cwd(), absolutePath).replace(/\\/g, "/")
  };
}
