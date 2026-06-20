"use client";

import { type DragEvent, type ChangeEvent, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadAccountingDocumentsAction, type AccountingDocumentUploadActionResult } from "./actions";

export function AccountingDocumentDropzone() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [result, setResult] = useState<AccountingDocumentUploadActionResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setSelectedFiles(files);
    const formData = new FormData();
    for (const file of files) formData.append("documents", file);
    startTransition(async () => {
      const response = await uploadAccountingDocumentsAction(formData);
      setResult(response);
      if (response.ok) router.refresh();
    });
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    uploadFiles(Array.from(event.dataTransfer.files));
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    uploadFiles(Array.from(event.currentTarget.files ?? []));
  }

  return (
    <div className="space-y-3">
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={`rounded-lg border-2 border-dashed p-6 text-center transition ${
          isDragging ? "border-amber-500 bg-amber-50" : "border-slate-300 bg-slate-50 hover:border-slate-400"
        }`}
      >
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          name="documents"
          multiple
          accept=".pdf,.eml,.txt,.html,.htm,.csv,.png,.jpg,.jpeg,.webp,.tif,.tiff,.bmp,.zip,application/pdf,message/rfc822,text/*,image/*,application/zip,application/x-zip-compressed"
          onChange={onChange}
        />
        <div className="mx-auto max-w-xl space-y-2">
          <p className="text-sm font-medium text-slate-900">Drag and drop invoices, order notices, emails, PDFs, receipts, screenshots, or Zipped Folders.</p>
          <p className="text-xs text-slate-600">
            Files are saved privately, hashed, text/OCR analyzed, deduped, and turned into reviewable accounting evidence. ZIP archives are unpacked first; uploading does not receive stock or mark anything paid.
          </p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isPending}
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Analyzing…" : "Upload & Analyze"}
          </button>
        </div>
      </div>

      {selectedFiles.length > 0 ? (
        <div className="rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-600">
          <span className="font-medium text-slate-800">Selected:</span> {selectedFiles.map((file) => file.name).join(", ")}
        </div>
      ) : null}

      {result ? (
        <div className={`rounded-md border p-3 text-sm ${result.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"}`} role="status">
          <p className="font-medium">{result.message}</p>
          {result.archiveSummaries?.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
              {result.archiveSummaries.map((archive) => (
                <li key={archive.archiveName}>
                  Expanded {archive.extractedCount} document{archive.extractedCount === 1 ? "" : "s"} from {archive.archiveName}
                  {archive.skippedCount > 0 ? ` · skipped ${archive.skippedCount} unsupported/metadata file${archive.skippedCount === 1 ? "" : "s"}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
          {result.documents.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
              {result.documents.map((document) => (
                <li key={document.id}>
                  {document.originalFileName} · {document.status}{document.duplicate ? " · duplicate linked" : ""}
                  {document.classification ? ` · ${document.classification}` : ""}
                  {document.invoiceNumber ? ` · invoice ${document.invoiceNumber}` : ""}
                  {document.total == null ? "" : ` · ${document.currency} ${document.total.toFixed(2)}`}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
