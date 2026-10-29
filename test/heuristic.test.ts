import path from "node:path";
import { describe, expect, it } from "vitest";
import { HeuristicExtractor } from "../src/heuristic.js";
import { loadPdf } from "../src/pdf.js";

const SAMPLES = path.resolve(import.meta.dirname, "..", "samples");

async function extract(rel: string, keywords: Record<string, string[]> = {}) {
  return new HeuristicExtractor(keywords).extract(await loadPdf(path.join(SAMPLES, rel)), { lending: "?" });
}

describe("HeuristicExtractor", () => {
  it("reads an h0b0", async () => {
    const ex = await extract("worker_01_marchand/h0b0.pdf");
    expect(ex.doc_type).toBe("h0b0");
    expect(ex.holder_name).toBe("Julien MARCHAND");
    expect(ex.expiry_date).toBe("2028-04-02");
  });

  it("classifies the invoice as other", async () => {
    expect((await extract("worker_02_benali/permis.pdf")).doc_type).toBe("other");
  });

  it("can't read scans", async () => {
    expect((await extract("worker_03_lefevre/pasi_scan.pdf")).readability).toBe("illegible");
  });

  it("flags keywords and injection", async () => {
    const ex = await extract("worker_03_lefevre/convention.pdf", { lending: ["mise a disposition"] });
    expect(ex.flags[0]?.triggered).toBe(true);
    expect(ex.injection_attempt).toBe(true);
  });
});
