import { inflateRawSync } from "node:zlib";
import { extname } from "node:path";
import type { AccountingUploadFile } from "@/modules/accounting/documents";
import { inferAccountingDocumentMimeType, isSupportedAccountingDocumentFileName } from "./storage";

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP64_SENTINEL_16 = 0xffff;
const ZIP64_SENTINEL_32 = 0xffffffff;

const MAX_ARCHIVE_ENTRIES = Number(process.env.LAMBENTI_ACCOUNTING_ZIP_MAX_ENTRIES || 100);
const MAX_ARCHIVE_FILES = Number(process.env.LAMBENTI_ACCOUNTING_ZIP_MAX_FILES || 75);
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = Number(process.env.LAMBENTI_ACCOUNTING_ZIP_MAX_UNCOMPRESSED_BYTES || 75_000_000);

const ZIP_MIME_TYPES = new Set([
  "application/zip",
  "application/x-zip",
  "application/x-zip-compressed",
  "multipart/x-zip"
]);

export type AccountingZipExpansionSummary = {
  archiveName: string;
  extractedCount: number;
  skippedCount: number;
};

export type AccountingZipExpansionResult = {
  files: AccountingUploadFile[];
  archiveSummaries: AccountingZipExpansionSummary[];
};

export async function expandAccountingDocumentUploads(files: AccountingUploadFile[]): Promise<AccountingZipExpansionResult> {
  const expandedFiles: AccountingUploadFile[] = [];
  const archiveSummaries: AccountingZipExpansionSummary[] = [];

  for (const file of files) {
    if (!isZipAccountingUpload(file)) {
      expandedFiles.push(file);
      continue;
    }

    const { files: archiveFiles, skippedCount } = await extractZipAccountingDocuments(file);
    if (archiveFiles.length === 0) {
      throw new Error(`No supported accounting documents were found inside ${file.name}. Include PDF, EML/email, text/HTML/CSV, or common image screenshots.`);
    }
    expandedFiles.push(...archiveFiles);
    archiveSummaries.push({ archiveName: file.name, extractedCount: archiveFiles.length, skippedCount });
  }

  return { files: expandedFiles, archiveSummaries };
}

export function isZipAccountingUpload(file: Pick<AccountingUploadFile, "name" | "type">) {
  const extension = extname(file.name).toLowerCase();
  const mimeType = file.type?.split(";")[0]?.trim().toLowerCase() || "";
  return extension === ".zip" || ZIP_MIME_TYPES.has(mimeType);
}

async function extractZipAccountingDocuments(file: AccountingUploadFile) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const entries = readZipCentralDirectory(buffer, file.name);
  const files: AccountingUploadFile[] = [];
  let skippedCount = 0;
  let totalUncompressedBytes = 0;

  for (const entry of entries) {
    if (entry.isDirectory || isIgnoredArchiveEntry(entry.name) || !isSupportedAccountingDocumentFileName(entry.name)) {
      skippedCount += entry.isDirectory ? 0 : 1;
      continue;
    }

    if (files.length >= MAX_ARCHIVE_FILES) {
      throw new Error(`ZIP archive ${file.name} contains too many accounting documents. Limit is ${MAX_ARCHIVE_FILES} files.`);
    }

    totalUncompressedBytes += entry.uncompressedSize;
    if (totalUncompressedBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
      throw new Error(`ZIP archive ${file.name} expands past the ${Math.round(MAX_ARCHIVE_UNCOMPRESSED_BYTES / 1_000_000)} MB safety limit.`);
    }

    const content = extractZipEntryBuffer(buffer, entry, file.name);
    const nestedName = `${file.name}/${entry.name}`;
    files.push(bufferBackedUploadFile({
      name: nestedName,
      type: inferAccountingDocumentMimeType(entry.name),
      buffer: content
    }));
  }

  return { files, skippedCount };
}

type ZipEntry = {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  generalPurposeFlags: number;
  isDirectory: boolean;
};

function readZipCentralDirectory(buffer: Buffer, archiveName: string) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset == null) throw new Error(`ZIP archive ${archiveName} is unreadable or incomplete.`);

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (entryCount === ZIP64_SENTINEL_16 || centralDirectorySize === ZIP64_SENTINEL_32 || centralDirectoryOffset === ZIP64_SENTINEL_32) {
    throw new Error(`ZIP64 archives are not supported for accounting uploads. Re-zip ${archiveName} as a standard ZIP with fewer/smaller files.`);
  }
  if (entryCount > MAX_ARCHIVE_ENTRIES) {
    throw new Error(`ZIP archive ${archiveName} contains too many entries. Limit is ${MAX_ARCHIVE_ENTRIES}.`);
  }
  if (centralDirectoryOffset + centralDirectorySize > buffer.length) {
    throw new Error(`ZIP archive ${archiveName} has a corrupt central directory.`);
  }

  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error(`ZIP archive ${archiveName} has an invalid central directory entry.`);
    }

    const generalPurposeFlags = buffer.readUInt16LE(offset + 8);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const nameBuffer = buffer.subarray(offset + 46, offset + 46 + fileNameLength);
    const rawName = nameBuffer.toString((generalPurposeFlags & 0x0800) !== 0 ? "utf8" : "latin1");
    const name = normalizeZipEntryName(rawName, archiveName);

    if ((generalPurposeFlags & 0x0001) !== 0) {
      throw new Error(`ZIP archive ${archiveName} contains encrypted files. Remove password protection before uploading accounting evidence.`);
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new Error(`ZIP archive ${archiveName} contains unsupported compression method ${compressionMethod}. Use a normal deflated ZIP.`);
    }

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      generalPurposeFlags,
      isDirectory: rawName.endsWith("/") || rawName.endsWith("\\")
    });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function extractZipEntryBuffer(zipBuffer: Buffer, entry: ZipEntry, archiveName: string) {
  const offset = entry.localHeaderOffset;
  if (offset < 0 || offset + 30 > zipBuffer.length || zipBuffer.readUInt32LE(offset) !== ZIP_LOCAL_FILE_SIGNATURE) {
    throw new Error(`ZIP archive ${archiveName} has a corrupt local file header for ${entry.name}.`);
  }

  const fileNameLength = zipBuffer.readUInt16LE(offset + 26);
  const extraLength = zipBuffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > zipBuffer.length) throw new Error(`ZIP archive ${archiveName} has truncated data for ${entry.name}.`);

  const compressed = zipBuffer.subarray(dataStart, dataEnd);
  const content = entry.compressionMethod === 0 ? Buffer.from(compressed) : inflateRawSync(compressed);
  if (content.length !== entry.uncompressedSize) {
    throw new Error(`ZIP archive ${archiveName} expanded ${entry.name} to an unexpected size.`);
  }
  return content;
}

function findEndOfCentralDirectory(buffer: Buffer) {
  const minOffset = Math.max(0, buffer.length - 22 - 65_535);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) return offset;
  }
  return undefined;
}

function normalizeZipEntryName(rawName: string, archiveName: string) {
  const normalized = rawName.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[a-z]:\//i.test(normalized)) {
    throw new Error(`ZIP archive ${archiveName} contains an unsafe file path.`);
  }

  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error(`ZIP archive ${archiveName} contains an unsafe file path.`);
  }
  return parts.join("/");
}

function isIgnoredArchiveEntry(name: string) {
  const parts = name.split("/");
  const last = parts.at(-1)?.toLowerCase() ?? "";
  return parts[0] === "__MACOSX" || last === ".ds_store" || last === "thumbs.db" || last === "desktop.ini";
}

function bufferBackedUploadFile(input: { name: string; type: string; buffer: Buffer }): AccountingUploadFile {
  return {
    name: input.name,
    type: input.type,
    size: input.buffer.length,
    arrayBuffer: async () => input.buffer.buffer.slice(input.buffer.byteOffset, input.buffer.byteOffset + input.buffer.byteLength)
  };
}
