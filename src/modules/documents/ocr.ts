import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type RecognizeImageTextInput = {
  content: Buffer;
  contentType: string;
  filename: string;
};

export async function recognizeImageText(input: RecognizeImageTextInput): Promise<string | null> {
  if (process.env.LAMBENTI_OCR_DISABLED === "true") return null;

  const nativeText = await recognizeWithNativeTesseract(input);
  if (nativeText) return nativeText;

  return recognizeWithTesseractJs(input);
}

async function recognizeWithNativeTesseract(input: RecognizeImageTextInput): Promise<string | null> {
  const tempDir = await mkdtemp(join(tmpdir(), "lambenti-ocr-"));
  const imagePath = join(tempDir, `attachment${extensionFor(input.filename, input.contentType)}`);

  try {
    await writeFile(imagePath, input.content);
    const { stdout } = await execFileAsync(
      process.env.LAMBENTI_OCR_TESSERACT_BIN || "tesseract",
      [imagePath, "stdout", "-l", process.env.LAMBENTI_OCR_LANG || "eng"],
      { timeout: Number(process.env.LAMBENTI_OCR_TIMEOUT_MS || 30_000), maxBuffer: 2_000_000 }
    );
    return normalizeOcrText(stdout);
  } catch {
    return null;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function recognizeWithTesseractJs(input: RecognizeImageTextInput): Promise<string | null> {
  if (process.env.LAMBENTI_TESSERACT_JS_DISABLED === "true") return null;

  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker(process.env.LAMBENTI_OCR_LANG || "eng", undefined, {
      cachePath: process.env.LAMBENTI_OCR_CACHE_DIR || join(process.cwd(), "var", "ocr-cache")
    });
    try {
      const result = await worker.recognize(input.content);
      return normalizeOcrText(result.data.text);
    } finally {
      await worker.terminate();
    }
  } catch {
    return null;
  }
}

function normalizeOcrText(text: string | undefined | null) {
  const trimmed = text?.trim();
  return trimmed ? trimmed : null;
}

function extensionFor(filename: string, contentType: string) {
  const existing = extname(filename || "").toLowerCase();
  if (/^\.(?:png|jpe?g|webp|tiff?|bmp)$/.test(existing)) return existing;

  switch (contentType.toLowerCase()) {
    case "image/png":
      return ".png";
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/tiff":
      return ".tiff";
    case "image/bmp":
      return ".bmp";
    default:
      return ".png";
  }
}
