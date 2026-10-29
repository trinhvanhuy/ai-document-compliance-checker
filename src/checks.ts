/** Standard Pixid checks, applied to every document whatever the client. */
import type { Extraction, Quote } from "./extractor.js";
import { fullName, isIsoDate, type CheckResult, type DocType, type Evidence, type Verdict, type Worker } from "./models.js";

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
  // the model is asked for YYYY-MM-DD but nothing forces it, "31/12/2026" would compare wrong
  if (!isIsoDate(ex.expiry_date)) {
    return result("not_expired", "needs_human_review", `expiry date "${ex.expiry_date}" is not a valid date`, 0.5, e);
  }
  // ISO dates compare as strings
  if (ex.expiry_date < today) return result("not_expired", "non_compliant", `expired on ${ex.expiry_date}`, 1, e);
  return result("not_expired", "compliant", `valid until ${ex.expiry_date}`, 1, e);
}

const nameTokens = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-'.,]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

// "Lefèvre-Durand" -> "durand lefevre", order independent
export const normalizeName = (name: string) => nameTokens(name).sort().join(" ");

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length, 1);
}

// "Marie Dupont épouse Martin", "Martin née Dupont": the document can carry the
// married and the maiden name, the worker file only one of them
const MARRIED_MARKERS = new Set(["epouse", "ep", "nee", "veuve", "vve"]);

/**
 * Edit cost of matching each worker token to its closest holder token.
 * Token by token with an absolute distance, a ratio is too strict on short names
 * ("Leo Marc" vs "Leo Mark" is 1 letter but only 0.875 similar).
 */
function tokenCost(worker: string[], holder: string[]): number {
  const left = [...holder];
  let cost = 0;
  for (const w of worker) {
    let best = -1;
    let bestD = Infinity;
    left.forEach((h, i) => {
      const d = levenshtein(w, h);
      if (d < bestD) [best, bestD] = [i, d];
    });
    if (best < 0) return Infinity;
    cost += bestD;
    left.splice(best, 1);
  }
  return cost;
}

const MAX_TYPOS = 2;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function checkName(ex: Extraction, worker: Worker): CheckResult | null {
  if (ex.doc_type === "other") return null;
  const e = ev(ex.holder_evidence);
  const name = fullName(worker);
  if (!ex.holder_name) return result("name_matches", "needs_human_review", "holder name not found on the document", 0.5, e);

  const w = nameTokens(name);
  const h = nameTokens(ex.holder_name);
  if (normalizeName(ex.holder_name) === normalizeName(name)) {
    return result("name_matches", "compliant", `holder ${ex.holder_name} matches worker`, 1, e);
  }

  const married = h.some((t) => MARRIED_MARKERS.has(t));
  const holderNames = h.filter((t) => !MARRIED_MARKERS.has(t));
  const cost = tokenCost(w, holderNames);

  if (married && cost <= 1) {
    const reason = `holder ${ex.holder_name} has a married / maiden name, check it is ${name}`;
    return result("name_matches", "needs_human_review", reason, 0.8, e);
  }
  if (cost <= MAX_TYPOS && holderNames.length === w.length) {
    // a letter or two off, typo or ocr error: let a human decide
    const reason = `holder ${ex.holder_name} is close to ${name}, check spelling`;
    return result("name_matches", "needs_human_review", reason, round2(nameSimilarity(ex.holder_name, name)), e);
  }
  if (cost === 0) {
    // all the worker's names are there plus some more (middle name)
    return result("name_matches", "needs_human_review", `holder ${ex.holder_name} has extra names, check it is ${name}`, 0.8, e);
  }
  return result("name_matches", "non_compliant", `holder is ${ex.holder_name}, worker is ${name}`, 1, e);
}

export function standardChecks(ex: Extraction, worker: Worker, declared: DocType | undefined, today: string): CheckResult[] {
  const optional = [checkInjection(ex), checkExpiry(ex, today), checkName(ex, worker)];
  return [checkReadable(ex), checkType(ex, declared), ...optional.filter((r): r is CheckResult => r !== null)];
}
