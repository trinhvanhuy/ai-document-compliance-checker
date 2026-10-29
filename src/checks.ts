/** Standard Pixid checks, applied to every document whatever the client. */
import type { Extraction, Quote } from "./extractor.js";
import { fullName, type CheckResult, type DocType, type Evidence, type Verdict, type Worker } from "./models.js";

// types that must carry an expiry date
const EXPIRING_TYPES: DocType[] = ["pasi", "caces", "h0b0", "driving_licence"];

export const MIN_TYPE_CONFIDENCE = 0.7;

const ev = (q: Quote | null): Evidence[] => (q ? [{ page: q.page ?? undefined, quote: q.text }] : []);

function result(check: string, verdict: Verdict, reason: string, confidence = 1, evidence: Evidence[] = []): CheckResult {
  return { check, verdict, reason, confidence, evidence };
}

export function checkReadable(ex: Extraction): CheckResult {
  if (ex.readability === "clear") return result("readable", "compliant", "document is readable");
  return result(
    "readable",
    "needs_human_review",
    `document is ${ex.readability}, key fields can't be read reliably`,
    ex.readability === "illegible" ? 0.3 : 0.6,
  );
}

export function checkInjection(ex: Extraction): CheckResult | null {
  if (!ex.injection_attempt) return null;
  return result(
    "suspicious_content",
    "needs_human_review",
    "document contains instructions aimed at the reviewer / AI, possible manipulation",
  );
}

export function checkType(ex: Extraction, declared: DocType | undefined): CheckResult {
  const e = ev(ex.type_evidence);
  const conf = ex.type_confidence;
  if (conf < MIN_TYPE_CONFIDENCE) {
    return result("document_type", "needs_human_review", `unsure about document type (looks like ${ex.doc_type})`, conf, e);
  }
  if (declared && declared !== ex.doc_type) {
    return result("document_type", "non_compliant", `uploaded as ${declared} but document is ${ex.doc_type}`, conf, e);
  }
  return result("document_type", "compliant", `document is ${ex.doc_type}`, conf, e);
}

export function checkExpiry(ex: Extraction, today: string): CheckResult | null {
  if (!EXPIRING_TYPES.includes(ex.doc_type)) return null;
  const e = ev(ex.date_evidence);
  if (!ex.expiry_date) return result("not_expired", "needs_human_review", "no expiry date found", 0.5, e);
  // ISO dates compare as strings
  if (ex.expiry_date < today) return result("not_expired", "non_compliant", `expired on ${ex.expiry_date}`, 1, e);
  return result("not_expired", "compliant", `valid until ${ex.expiry_date}`, 1, e);
}

const tokens = (name: string) =>
  name.toLowerCase().replace(/-/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");

export function checkName(ex: Extraction, worker: Worker): CheckResult | null {
  if (ex.doc_type === "other") return null;
  const e = ev(ex.holder_evidence);
  const name = fullName(worker);
  if (!ex.holder_name) return result("name_matches", "needs_human_review", "holder name not found on the document", 0.5, e);
  if (tokens(ex.holder_name) === tokens(name)) {
    return result("name_matches", "compliant", `holder ${ex.holder_name} matches worker`, 1, e);
  }
  return result("name_matches", "non_compliant", `holder is ${ex.holder_name}, worker is ${name}`, 1, e);
}

export function standardChecks(ex: Extraction, worker: Worker, declared: DocType | undefined, today: string): CheckResult[] {
  const optional = [checkInjection(ex), checkExpiry(ex, today), checkName(ex, worker)];
  return [checkReadable(ex), checkType(ex, declared), ...optional.filter((r): r is CheckResult => r !== null)];
}
