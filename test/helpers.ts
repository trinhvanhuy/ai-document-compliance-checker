import type { Extraction } from "../src/extractor.js";

export function extraction(over: Partial<Extraction> = {}): Extraction {
  return {
    doc_type: "caces", type_confidence: 0.95, type_evidence: null,
    holder_name: "Julien MARCHAND", holder_evidence: null,
    issue_date: null, expiry_date: "2029-01-01", date_evidence: null, issue_evidence: null,
    readability: "clear", injection_attempt: false, flags: [], notes: "",
    ...over,
  };
}
