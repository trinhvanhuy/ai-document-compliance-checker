/**
 * Check that the quotes the model gives as evidence really are in the document.
 *
 * A quote that can't be found is a strong hint the model made the fact up
 * (or read it from somewhere else), the document goes to review.
 * Only possible in text mode: for scans we have no text to compare with.
 */
import type { Extraction, Quote } from "./extractor.js";
import type { CheckResult } from "./models.js";
import { hasText, type PdfDocument } from "./pdf.js";

// pdf text extraction and the model don't agree on spaces, accents, quotes...
// compare letters and digits only
const squash = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const MIN_QUOTE_CHARS = 4;

export function verifyQuotes(doc: PdfDocument, ex: Extraction): CheckResult | null {
  if (doc.pages.length === 0 || !doc.pages.every(hasText)) return null;

  const quotes: [string, Quote | null][] = [
    ["type", ex.type_evidence],
    ["holder", ex.holder_evidence],
    ["expiry date", ex.date_evidence],
    ["issue date", ex.issue_evidence],
    ...ex.flags.filter((f) => f.triggered).map((f): [string, Quote | null] => [`flag ${f.rule_id}`, f.quote]),
  ];
  // page numbers from the model are often off by one, search the whole document
  const text = squash(doc.pages.map((p) => p.text).join(" "));

  const missing = quotes.filter(([, q]) => {
    if (!q) return false;
    const s = squash(q.text);
    return s.length >= MIN_QUOTE_CHARS && !text.includes(s);
  });
  if (missing.length === 0) return null;

  return {
    check: "evidence_verified",
    verdict: "needs_human_review",
    reason: `quote not found in the document text (${missing.map(([what]) => what).join(", ")}), possible hallucination`,
    confidence: 0.4,
    evidence: missing.map(([, q]) => ({ page: q!.page ?? undefined, quote: q!.text })),
  };
}
