import path from "node:path";
import { describe, expect, it } from "vitest";
import { HeuristicExtractor } from "../src/heuristic.js";
import { loadPdf, type PdfDocument } from "../src/pdf.js";
import { verifyQuotes } from "../src/verify.js";
import { extraction } from "./helpers.js";

const SAMPLES = path.resolve(import.meta.dirname, "..", "samples");

const doc: PdfDocument = {
  path: "x", name: "caces.pdf", bytes: new Uint8Array(),
  pages: [{ number: 1, text: "CERTIFICAT CACES® R489\nTitulaire : Julien MARCHAND\nDate de fin de validité :  12/03/2029" }],
};

describe("verifyQuotes", () => {
  it("accepts quotes that differ only by spaces, case or accents", () => {
    const ex = extraction({
      holder_evidence: { page: 1, text: "Titulaire: Julien Marchand" },
      date_evidence: { page: 2, text: "Date de fin de validite : 12/03/2029" },
    });
    expect(verifyQuotes(doc, ex)).toBeNull();
  });

  it("flags a quote that is not in the document", () => {
    const ex = extraction({ date_evidence: { page: 1, text: "Valable jusqu'au 12/03/2031" } });
    const r = verifyQuotes(doc, ex);
    expect(r?.verdict).toBe("needs_human_review");
    expect(r?.reason).toContain("expiry date");
    expect(r?.evidence[0]?.quote).toBe("Valable jusqu'au 12/03/2031");
  });

  it("skips scans, there is no text to compare with", async () => {
    const scan = await loadPdf(path.join(SAMPLES, "worker_03_lefevre", "pasi_scan.pdf"));
    expect(verifyQuotes(scan, extraction({ date_evidence: { page: 1, text: "anything at all" } }))).toBeNull();
  });

  it("heuristic quotes on the samples are all found", async () => {
    for (const f of ["worker_01_marchand/h0b0.pdf", "worker_02_benali/caces.pdf", "worker_02_benali/atex.pdf"]) {
      const d = await loadPdf(path.join(SAMPLES, f));
      const ex = await new HeuristicExtractor().extract(d, {});
      expect(ex.issue_evidence ?? ex.date_evidence).not.toBeNull();
      expect(verifyQuotes(d, ex)).toBeNull();
    }
  });
});
