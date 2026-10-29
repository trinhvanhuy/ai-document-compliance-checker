import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Worker } from "./models.js";
import { loadPdf, type PdfDocument } from "./pdf.js";

export interface WorkerFile {
  folder: string;
  worker: Worker;
  documents: PdfDocument[];
}

/** A worker file = a folder with worker.json + the pdf attachments. */
export async function loadWorkerFile(folder: string): Promise<WorkerFile> {
  const worker = Worker.parse(JSON.parse(await readFile(path.join(folder, "worker.json"), "utf8")));
  const pdfs = (await readdir(folder)).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
  const documents = await Promise.all(pdfs.map((f) => loadPdf(path.join(folder, f))));
  return { folder, worker, documents };
}
