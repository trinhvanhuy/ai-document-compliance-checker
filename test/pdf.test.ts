import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
});
