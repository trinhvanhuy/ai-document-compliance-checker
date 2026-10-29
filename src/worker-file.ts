import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Worker } from "./models.js";
import { loadPdf, type PdfDocument } from "./pdf.js";

export interface WorkerFile {
  folder: string;
  worker: Worker;
  documents: PdfDocument[];
}

// a document we can't read still shows up in the report (as needs_human_review),
// dropping it silently would hide e.g. a phone photo of the CACES
const unreadable = (folder: string, name: string, error: string): PdfDocument => ({
  path: path.join(folder, name),
  name,
  bytes: new Uint8Array(),
  pages: [],
  error,
});

/** A worker file = a folder with worker.json + the attachments. */
export async function loadWorkerFile(folder: string): Promise<WorkerFile> {
  const worker = Worker.parse(JSON.parse(await readFile(path.join(folder, "worker.json"), "utf8")));
  const files = (await readdir(folder)).filter((f) => f !== "worker.json" && !f.startsWith(".")).sort();

  const documents = await Promise.all(
    files.map((f) =>
      f.toLowerCase().endsWith(".pdf")
        ? loadPdf(path.join(folder, f))
        : unreadable(folder, f, `unsupported file type (${path.extname(f) || "no extension"}), only pdf is read`),
    ),
  );
  for (const name of Object.keys(worker.declared_documents)) {
    if (!files.includes(name)) documents.push(unreadable(folder, name, "declared in worker.json but the file is missing"));
  }
  return { folder, worker, documents };
}
