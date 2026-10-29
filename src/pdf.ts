import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";

// below this many chars on a page we consider it a scan / image
export const MIN_TEXT_CHARS = 40;

export interface Page {
  number: number; // 1-based
  text: string;
}

export interface PdfDocument {
  path: string;
  name: string;
  bytes: Uint8Array;
  pages: Page[];
  error?: string;
}

export const hasText = (p: Page) => p.text.trim().length >= MIN_TEXT_CHARS;

export const isScanned = (doc: PdfDocument) => doc.pages.length > 0 && !doc.pages.some(hasText);

export async function loadPdf(file: string, maxPages = 10): Promise<PdfDocument> {
  const bytes = new Uint8Array(await readFile(file));
  const doc: PdfDocument = { path: file, name: path.basename(file), bytes, pages: [] };
  try {
    // unpdf transfers the buffer to the worker, give it a copy
    const pdf = await getDocumentProxy(bytes.slice());
    const { text } = await extractText(pdf, { mergePages: false });
    doc.pages = text.slice(0, maxPages).map((t, i) => ({ number: i + 1, text: t }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    doc.error = /password/i.test(msg) ? "pdf is password protected" : `cannot open pdf: ${msg}`;
  }
  return doc;
}
