import { copyFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { isScanned, loadPdf } from "../src/pdf.js";

export const SAMPLES = path.resolve(import.meta.dirname, "..", "samples");

describe("loadPdf", () => {
  it("reads the text layer", async () => {
    const doc = await loadPdf(path.join(SAMPLES, "worker_01_marchand", "h0b0.pdf"));
    expect(doc.error).toBeUndefined();
    expect(isScanned(doc)).toBe(false);
    expect(doc.pages[0]?.text).toContain("H0 B0");
  });

  it("detects scans", async () => {
    const doc = await loadPdf(path.join(SAMPLES, "worker_03_lefevre", "pasi_scan.pdf"));
    expect(isScanned(doc)).toBe(true);
  });

  it("does not crash on a broken file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pdf-"));
    const f = path.join(dir, "broken.pdf");
    await writeFile(f, "not a pdf at all");
    const doc = await loadPdf(f);
    expect(doc.error).toBeTruthy();
  });

  it("marks long pdfs as truncated", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= 12; i++) {
      pdf.addPage().drawText(`Page ${i} of a long contract, enough text to not look like a scan`, { x: 50, y: 700, font, size: 12 });
    }
    const f = path.join(await mkdtemp(path.join(tmpdir(), "pdf-")), "long.pdf");
    await writeFile(f, await pdf.save());
    const doc = await loadPdf(f);
    expect(doc.pages).toHaveLength(10);
    expect(doc.totalPages).toBe(12);
  });
});

describe("loadWorkerFile", () => {
  it("loads worker.json and the attachments", async () => {
    const { loadWorkerFile } = await import("../src/worker-file.js");
    const wf = await loadWorkerFile(path.join(SAMPLES, "worker_02_benali"));
    expect(wf.worker.last_name).toBe("Benali");
    expect(wf.documents).toHaveLength(3);
    expect(wf.worker.declared_documents["permis.pdf"]).toBe("driving_licence");
  });

  it("keeps non pdf and missing attachments as errors", async () => {
    const { loadWorkerFile } = await import("../src/worker-file.js");
    const dir = await mkdtemp(path.join(tmpdir(), "wf-"));
    const declared = { "pasi.pdf": "pasi", "caces.jpg": "caces", "h0b0.pdf": "h0b0" };
    await writeFile(path.join(dir, "worker.json"), JSON.stringify({ first_name: "a", last_name: "b", declared_documents: declared }));
    await copyFile(path.join(SAMPLES, "worker_01_marchand", "pasi.pdf"), path.join(dir, "pasi.pdf"));
    await writeFile(path.join(dir, "caces.jpg"), "fake jpeg");

    const docs = Object.fromEntries((await loadWorkerFile(dir)).documents.map((d) => [d.name, d]));
    expect(Object.keys(docs).sort()).toEqual(["caces.jpg", "h0b0.pdf", "pasi.pdf"]);
    expect(docs["pasi.pdf"]?.error).toBeUndefined();
    expect(docs["caces.jpg"]?.error).toMatch(/unsupported file type \(\.jpg\)/);
    expect(docs["h0b0.pdf"]?.error).toMatch(/missing/);
  });
});
