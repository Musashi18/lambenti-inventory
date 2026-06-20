import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { expandAccountingDocumentUploads, isZipAccountingUpload } from "./zip";

function uploadFile(name: string, type: string, buffer: Buffer) {
  return {
    name,
    type,
    size: buffer.length,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  };
}

type ZipTestEntry = {
  name: string;
  content?: string;
  method?: 0 | 8;
};

function createZip(entries: ZipTestEntry[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.from(entry.content ?? "", "utf8");
    const method = entry.method ?? 0;
    const compressed = method === 8 ? deflateRawSync(raw) : raw;

    const localHeader = Buffer.alloc(30 + name.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    name.copy(localHeader, 30);

    const centralHeader = Buffer.alloc(46 + name.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    name.copy(centralHeader, 46);

    localParts.push(localHeader, compressed);
    centralParts.push(centralHeader);
    localOffset += localHeader.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);

  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

describe("accounting ZIP upload expansion", () => {
  it("detects ZIP uploads by extension or browser MIME type", () => {
    expect(isZipAccountingUpload({ name: "supplier-bills.zip", type: "" })).toBe(true);
    expect(isZipAccountingUpload({ name: "download", type: "application/x-zip-compressed" })).toBe(true);
    expect(isZipAccountingUpload({ name: "invoice.pdf", type: "application/pdf" })).toBe(false);
  });

  it("expands supported accounting files from zipped folders and skips OS metadata", async () => {
    const zip = createZip([
      { name: "supplier-bills/", content: "" },
      { name: "supplier-bills/june-invoice.txt", content: "Invoice number: TEST-ZIP-001\nTotal USD 15.00" },
      { name: "supplier-bills/receipt.csv", content: "kind,total\nreceipt,15.00", method: 8 },
      { name: "__MACOSX/._june-invoice.txt", content: "metadata" },
      { name: "supplier-bills/notes.docx", content: "unsupported" }
    ]);

    const result = await expandAccountingDocumentUploads([
      uploadFile("TEST-ACCOUNTING-DOC-ARCHIVE.zip", "application/zip", zip)
    ]);

    expect(result.files).toHaveLength(2);
    expect(result.files.map((file) => file.name)).toEqual([
      "TEST-ACCOUNTING-DOC-ARCHIVE.zip/supplier-bills/june-invoice.txt",
      "TEST-ACCOUNTING-DOC-ARCHIVE.zip/supplier-bills/receipt.csv"
    ]);
    expect(result.files.map((file) => file.type)).toEqual(["text/plain", "text/csv"]);
    expect(result.archiveSummaries).toEqual([
      { archiveName: "TEST-ACCOUNTING-DOC-ARCHIVE.zip", extractedCount: 2, skippedCount: 2 }
    ]);
  });

  it("rejects path traversal entries before extraction", async () => {
    const zip = createZip([{ name: "../invoice.txt", content: "Invoice number: BAD" }]);

    await expect(expandAccountingDocumentUploads([
      uploadFile("TEST-ACCOUNTING-DOC-UNSAFE.zip", "application/zip", zip)
    ])).rejects.toThrow("unsafe file path");
  });
});
