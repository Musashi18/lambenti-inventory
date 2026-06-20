import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";
import { recognizeImageText as defaultRecognizeImageText, type RecognizeImageTextInput } from "@/modules/documents/ocr";
import { sourceToImportTexts } from "@/modules/email-imports/mailbox";

const execFileAsync = promisify(execFile);
const MAX_EXTRACTED_TEXT_CHARS = 250_000;
const DEFAULT_PDF_OCR_MAX_PAGES = 5;
const PDF_IMAGE_STREAM_LIMIT = 20;

export type ExtractAccountingDocumentTextInput = {
  buffer: Buffer;
  mimeType: string;
  originalFileName: string;
};

export type ExtractAccountingDocumentTextResult = {
  text?: string;
  warnings: string[];
};

export type RenderedDocumentImagePage = RecognizeImageTextInput;

export type ExtractAccountingDocumentTextDependencies = {
  recognizeImageText?: (input: RecognizeImageTextInput) => Promise<string | null>;
  pdfTextExtractor?: (buffer: Buffer) => Promise<string | undefined>;
  pdfPageImageExtractor?: (input: ExtractAccountingDocumentTextInput) => Promise<RenderedDocumentImagePage[]>;
};

export async function extractAccountingDocumentText(
  input: ExtractAccountingDocumentTextInput,
  dependencies: ExtractAccountingDocumentTextDependencies = {}
): Promise<ExtractAccountingDocumentTextResult> {
  const mimeType = input.mimeType.toLowerCase();
  const extension = extname(input.originalFileName).toLowerCase();
  const recognizeImageText = dependencies.recognizeImageText ?? defaultRecognizeImageText;

  if (mimeType === "message/rfc822" || extension === ".eml") {
    const texts = await sourceToImportTexts(input.buffer, { ocrImageText: recognizeImageText });
    return { text: truncateText(texts.filter(Boolean).join("\n\n--- attachment/source boundary ---\n\n")), warnings: [] };
  }

  if (mimeType.startsWith("text/") || [".txt", ".csv", ".html", ".htm"].includes(extension)) {
    const raw = input.buffer.toString("utf8");
    const text = mimeType.includes("html") || extension === ".html" || extension === ".htm" ? stripHtml(raw) : raw;
    return { text: truncateText(text), warnings: [] };
  }

  if (mimeType === "application/pdf" || extension === ".pdf") {
    const pdfTextExtractor = dependencies.pdfTextExtractor ?? extractPdfText;
    const embeddedText = normalizePdfText(await pdfTextExtractor(input.buffer));
    if (embeddedText) return { text: truncateText(embeddedText), warnings: [] };

    const ocr = await extractScannedPdfText(input, { ...dependencies, recognizeImageText });
    return {
      text: truncateText(ocr.text),
      warnings: ocr.text
        ? ["PDF had no embedded text; OCR was used on rendered page images. Review extracted fields carefully.", ...ocr.warnings]
        : [manualPdfReviewWarning(), ...ocr.warnings]
    };
  }

  if (mimeType.startsWith("image/") || /\.(?:png|jpe?g|webp|tiff?|bmp)$/i.test(extension)) {
    const text = await recognizeImageText({ content: input.buffer, contentType: input.mimeType, filename: input.originalFileName });
    return {
      text: truncateText(text ?? undefined),
      warnings: text ? [] : ["Image OCR is unavailable or returned no text. Paste extracted text manually or install/configure OCR support for screenshot analysis."]
    };
  }

  return { warnings: ["No extractor is available for this accounting document type. Paste extracted text manually if this file contains accounting evidence."] };
}

async function extractScannedPdfText(
  input: ExtractAccountingDocumentTextInput,
  dependencies: Required<Pick<ExtractAccountingDocumentTextDependencies, "recognizeImageText">> & ExtractAccountingDocumentTextDependencies
) {
  const warnings: string[] = [];
  let pages: RenderedDocumentImagePage[] = [];

  try {
    pages = dependencies.pdfPageImageExtractor
      ? await dependencies.pdfPageImageExtractor(input)
      : await renderPdfPagesToImages(input);
  } catch (error) {
    warnings.push(`PDF page rendering for OCR failed: ${errorMessage(error)}.`);
  }

  if (pages.length === 0) {
    warnings.push("No rendered PDF page images were available for OCR. Paste extracted text manually or install/configure PDF OCR support.");
    return { text: undefined, warnings };
  }

  const textParts: string[] = [];
  for (const [index, page] of pages.entries()) {
    try {
      const text = await dependencies.recognizeImageText(page);
      if (text?.trim()) textParts.push(`--- Page ${index + 1}: ${page.filename} ---\n${text.trim()}`);
    } catch (error) {
      warnings.push(`OCR failed for ${page.filename}: ${errorMessage(error)}.`);
    }
  }

  if (textParts.length === 0) {
    warnings.push("PDF OCR ran but returned no text. Paste extracted text manually or retry with a higher-quality source document.");
    return { text: undefined, warnings };
  }

  return { text: textParts.join("\n\n"), warnings };
}

async function renderPdfPagesToImages(input: ExtractAccountingDocumentTextInput): Promise<RenderedDocumentImagePage[]> {
  if (process.env.LAMBENTI_OCR_DISABLED === "true" || process.env.LAMBENTI_PDF_OCR_DISABLED === "true") return [];

  const maxPages = Math.max(1, Number(process.env.LAMBENTI_PDF_OCR_MAX_PAGES || DEFAULT_PDF_OCR_MAX_PAGES));
  const embeddedImages = extractEmbeddedPdfImages(input.buffer, input.originalFileName).slice(0, maxPages);
  if (embeddedImages.length > 0) return embeddedImages;

  const tempDir = await mkdtemp(join(tmpdir(), "lambenti-pdf-ocr-"));
  const pdfPath = join(tempDir, "document.pdf");
  const outputPrefix = join(tempDir, "page");
  const dpi = Math.max(96, Number(process.env.LAMBENTI_PDF_OCR_DPI || 180));

  try {
    await writeFile(pdfPath, input.buffer);
    await execFileAsync(
      process.env.LAMBENTI_PDFTOPPM_BIN || "pdftoppm",
      ["-png", "-r", String(dpi), "-f", "1", "-l", String(maxPages), pdfPath, outputPrefix],
      { timeout: Number(process.env.LAMBENTI_PDF_OCR_TIMEOUT_MS || 60_000), maxBuffer: 2_000_000 }
    );

    const pageFiles = (await readdir(tempDir))
      .filter((fileName) => /^page-\d+\.png$/i.test(fileName))
      .sort((a, b) => pageNumber(a) - pageNumber(b));

    return Promise.all(pageFiles.map(async (fileName) => ({
      content: await readFile(join(tempDir, fileName)),
      contentType: "image/png",
      filename: `${basename(input.originalFileName, extname(input.originalFileName))}-${fileName}`
    })));
  } catch (error) {
    if (isMissingExecutableError(error)) {
      throw new Error(`Poppler pdftoppm is not installed or not on PATH. Set LAMBENTI_PDFTOPPM_BIN or install Poppler; embedded-image PDF OCR fallback found no directly extractable JPEG/JPX images in ${input.originalFileName}.`);
    }
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function extractEmbeddedPdfImages(buffer: Buffer, originalFileName: string): RenderedDocumentImagePage[] {
  const pdf = buffer.toString("latin1");
  const images: RenderedDocumentImagePage[] = [];
  const streamPattern = /<<(.*?)>>\s*stream\r?\n?([\s\S]*?)\r?\n?endstream/g;
  const baseName = basename(originalFileName, extname(originalFileName));

  for (const match of pdf.matchAll(streamPattern)) {
    if (images.length >= PDF_IMAGE_STREAM_LIMIT) break;
    const dictionary = match[1] ?? "";
    if (!/\/Subtype\s*\/Image\b/i.test(dictionary)) continue;

    const filterMatch = dictionary.match(/\/Filter\s*(?:\[(.*?)\]|\/(\w+))/is);
    const filters = `${filterMatch?.[1] ?? ""} ${filterMatch?.[2] ?? ""}`;
    const isJpeg = /DCTDecode/i.test(filters);
    const isJp2 = /JPXDecode/i.test(filters);
    if (!isJpeg && !isJp2) continue;

    const content = stripPdfStreamLineBreaks(match[2] ?? "");
    if (content.length === 0) continue;
    const extension = isJpeg ? "jpg" : "jp2";
    images.push({
      content: Buffer.from(content, "latin1"),
      contentType: isJpeg ? "image/jpeg" : "image/jp2",
      filename: `${baseName}-embedded-image-${images.length + 1}.${extension}`
    });
  }

  return images;
}

function stripPdfStreamLineBreaks(value: string) {
  return value.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
}

async function extractPdfText(buffer: Buffer) {
  const parsedText = await extractPdfTextWithPdfParse(buffer);
  if (parsedText?.trim()) return parsedText;

  return extractPdfTextWithPdftotext(buffer);
}

async function extractPdfTextWithPdfParse(buffer: Buffer) {
  try {
    const pdfParseModule = await import("pdf-parse") as PdfParseModule;
    if (typeof pdfParseModule.default === "function") {
      const parsed = await pdfParseModule.default(buffer);
      return parsed?.text;
    }
    if (typeof pdfParseModule.PDFParse === "function") {
      const parser = new pdfParseModule.PDFParse({ data: buffer });
      try {
        const parsed = await parser.getText();
        return parsed?.text ?? parsed?.pages?.map((page) => page.text).join("\n");
      } finally {
        await parser.destroy?.();
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function extractPdfTextWithPdftotext(buffer: Buffer) {
  if (process.env.LAMBENTI_PDFTOTEXT_DISABLED === "true") return undefined;

  const tempDir = await mkdtemp(join(tmpdir(), "lambenti-pdf-text-"));
  const pdfPath = join(tempDir, "document.pdf");
  try {
    await writeFile(pdfPath, buffer);
    const { stdout } = await execFileAsync(
      process.env.LAMBENTI_PDFTOTEXT_BIN || "pdftotext",
      ["-layout", "-enc", "UTF-8", pdfPath, "-"],
      { timeout: Number(process.env.LAMBENTI_PDF_TEXT_TIMEOUT_MS || 30_000), maxBuffer: 5_000_000 }
    );
    return stdout;
  } catch {
    return undefined;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

type PdfParseModule = {
  default?: (buffer: Buffer) => Promise<{ text?: string }>;
  PDFParse?: new (input: { data: Buffer }) => {
    getText: () => Promise<{ text?: string; pages?: Array<{ text: string }> }>;
    destroy?: () => Promise<void> | void;
  };
};

function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizePdfText(text: string | undefined) {
  const withoutPageMarkers = text
    ?.replace(/--\s*\d+\s+of\s+\d+\s*--/gi, " ")
    .replace(/\f/g, " ")
    .trim();
  return withoutPageMarkers ? withoutPageMarkers : undefined;
}

function truncateText(text: string | undefined | null) {
  const trimmed = text?.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_EXTRACTED_TEXT_CHARS);
}

function manualPdfReviewWarning() {
  return "PDF text extraction returned no text and OCR did not produce readable text. Paste extracted text manually or install/configure OCR support for scanned PDFs.";
}

function pageNumber(fileName: string) {
  return Number(fileName.match(/page-(\d+)\.png/i)?.[1] ?? 0);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "unknown error";
}

function isMissingExecutableError(error: unknown) {
  return typeof error === "object"
    && error !== null
    && ("code" in error)
    && (error as { code?: unknown }).code === "ENOENT";
}
