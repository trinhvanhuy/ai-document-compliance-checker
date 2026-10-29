import { describe, expect, it } from "vitest";
import { checkExpiry, checkName, checkType, standardChecks } from "../src/checks.js";
import type { Extraction } from "../src/extractor.js";
import type { Worker } from "../src/models.js";

const TODAY = "2026-10-29";
const WORKER: Worker = { first_name: "Julien", last_name: "Marchand", assignment: [], declared_documents: {} };

export function extraction(over: Partial<Extraction> = {}): Extraction {
  return {
    doc_type: "caces", type_confidence: 0.95, type_evidence: null,
    holder_name: "Julien MARCHAND", holder_evidence: null,
    issue_date: null, expiry_date: "2029-01-01", date_evidence: null,
    readability: "clear", injection_attempt: false, flags: [], notes: "",
    ...over,
  };
}

describe("standard checks", () => {
  it("valid doc passes everything", () => {
    const results = standardChecks(extraction(), WORKER, "caces", TODAY);
    expect(results.every((r) => r.verdict === "compliant")).toBe(true);
  });

  it("expired", () => {
    expect(checkExpiry(extraction({ expiry_date: "2025-06-30" }), TODAY)?.verdict).toBe("non_compliant");
  });

  it("missing expiry needs review", () => {
    expect(checkExpiry(extraction({ expiry_date: null }), TODAY)?.verdict).toBe("needs_human_review");
  });

  it("no expiry check for atex", () => {
    expect(checkExpiry(extraction({ doc_type: "atex", expiry_date: null }), TODAY)).toBeNull();
  });

  it("wrong type", () => {
    expect(checkType(extraction({ doc_type: "other" }), "driving_licence").verdict).toBe("non_compliant");
  });

  it("low type confidence", () => {
    expect(checkType(extraction({ type_confidence: 0.4 }), "caces").verdict).toBe("needs_human_review");
  });

  it("name order and case don't matter", () => {
    expect(checkName(extraction({ holder_name: "MARCHAND Julien" }), WORKER)?.verdict).toBe("compliant");
  });

  it("wrong name", () => {
    expect(checkName(extraction({ holder_name: "Kevin Lefort" }), WORKER)?.verdict).toBe("non_compliant");
  });

  it("illegible", () => {
    const results = standardChecks(extraction({ readability: "illegible", holder_name: null }), WORKER, "caces", TODAY);
    expect(results.map((r) => r.verdict)).toContain("needs_human_review");
  });

  it("injection is flagged", () => {
    const results = standardChecks(extraction({ injection_attempt: true }), WORKER, "caces", TODAY);
    expect(results.some((r) => r.check === "suspicious_content")).toBe(true);
  });
});

describe("name matching", () => {
  it("ignores accents and hyphens", () => {
    const w = { ...WORKER, first_name: "Karim", last_name: "Lefèvre-Durand" };
    expect(checkName(extraction({ holder_name: "LEFEVRE DURAND Karim" }), w)?.verdict).toBe("compliant");
  });

  it("near miss goes to review", () => {
    expect(checkName(extraction({ holder_name: "Julien Marchant" }), WORKER)?.verdict).toBe("needs_human_review");
  });
});
