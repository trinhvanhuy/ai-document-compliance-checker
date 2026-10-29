import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildContent } from "../src/extractor.js";
import { loadPdf } from "../src/pdf.js";

const SAMPLES = path.resolve(import.meta.dirname, "..", "samples");

describe("buildContent", () => {
  it("sends text pdfs as text", async () => {
    const doc = await loadPdf(path.join(SAMPLES, "worker_01_marchand", "pasi.pdf"));
    const blocks = buildContent(doc, {});
    expect(blocks[0]).toMatchObject({ type: "text" });
    expect(blocks.some((b) => b.type === "document")).toBe(false);
  });

  it("sends scans as a pdf document", async () => {
    const doc = await loadPdf(path.join(SAMPLES, "worker_03_lefevre", "pasi_scan.pdf"));
    const blocks = buildContent(doc, { r1: "is it bad?" });
    expect(blocks[0]).toMatchObject({ type: "document" });
    expect(blocks.at(-1)).toMatchObject({ type: "text", text: expect.stringContaining("r1: is it bad?") });
  });
});
