/**
 * Regex/keyword extractor.
 *
 * Used for tests and to run the pipeline without an API key (--offline).
 * It only knows the layouts of our synthetic samples, don't expect much more.
 */
import type { Extraction, Extractor, FlagAnswer, Quote } from "./extractor.js";
import type { DocType } from "./models.js";
import { isScanned, type PdfDocument } from "./pdf.js";

const TYPE_KEYWORDS: [DocType, string[]][] = [
  ["h0b0", ["habilitation electrique", "h0 b0", "h0b0"]],
  ["caces", ["caces"]],
  ["atex", ["atex"]],
  ["pasi", ["passeport securite interim", "pasi"]],
  ["driving_licence", ["permis de conduire"]],
];

const NAME_RE = /(?:Titulaire|Candidat|Stagiaire)\s*:\s*(.+)/;
const NOM_PRENOM_RE = /Nom\s*:\s*(\S+)\s+Prenom\s*:\s*(\S+)/;
const ISSUE_RE = /(?:delivrance|obtention|validee le|Date de la formation)\s*:\s*(\d{2}\/\d{2}\/\d{4})/;
const EXPIRY_RE = /(?:fin de validite|Valable jusqu'au)\s*:\s*(\d{2}\/\d{2}\/\d{4})/;
const INJECTION_RE = /ignore (all )?previous instructions|for ai reviewers/i;

const iso = (d: string) => d.split("/").reverse().join("-");

// the line the regex matched in, as the evidence quote
function lineQuote(text: string, m: RegExpExecArray | null): Quote | null {
  const line = m && text.split("\n").find((l) => l.includes(m[0]));
  return line ? { page: 1, text: line.trim() } : null;
}

export class HeuristicExtractor implements Extractor {
  // rule id -> keywords, a flag triggers if any keyword is in the text
  constructor(private flagKeywords: Record<string, string[]> = {}) {}

  async extract(doc: PdfDocument, flagQuestions: Record<string, string>): Promise<Extraction> {
    const empty = {
      type_evidence: null, holder_name: null, holder_evidence: null, issue_date: null,
      expiry_date: null, date_evidence: null, issue_evidence: null, injection_attempt: false, flags: [], notes: "",
    };
    if (doc.pages.length === 0 || isScanned(doc)) {
      return { ...empty, doc_type: "other", type_confidence: 0, readability: "illegible",
               notes: "no text layer, heuristic extractor can't read scans" };
    }

    const text = doc.pages.map((p) => p.text).join("\n");
    const low = text.toLowerCase();

    // readable text but no known keyword -> fairly sure it's something else
    let docType: DocType = "other";
    let confidence = 0.75;
    let typeEvidence: Quote | null = null;
    for (const [type, words] of TYPE_KEYWORDS) {
      const hit = words.find((w) => low.includes(w));
      if (hit) {
        docType = type;
        confidence = 0.8;
        const line = text.split("\n").find((l) => l.toLowerCase().includes(hit)) ?? hit;
        typeEvidence = { page: 1, text: line.trim() };
        break;
      }
    }

    let holder: string | null = null;
    const np = NOM_PRENOM_RE.exec(text);
    const n = NAME_RE.exec(text);
    if (np) holder = `${np[2]} ${np[1]}`;
    else if (n?.[1]) holder = n[1].trim();

    const issueMatch = ISSUE_RE.exec(text);
    const expiryMatch = EXPIRY_RE.exec(text);
    const issue = issueMatch?.[1];
    const expiry = expiryMatch?.[1];

    const flags: FlagAnswer[] = Object.keys(flagQuestions).map((id) => {
      const hit = (this.flagKeywords[id] ?? []).some((w) => low.includes(w.toLowerCase()));
      return { rule_id: id, triggered: hit, confidence: hit ? 0.5 : 0.3, quote: null };
    });

    return {
      ...empty,
      doc_type: docType,
      type_confidence: confidence,
      type_evidence: typeEvidence,
      holder_name: holder,
      issue_date: issue ? iso(issue) : null,
      expiry_date: expiry ? iso(expiry) : null,
      date_evidence: lineQuote(text, expiryMatch),
      issue_evidence: lineQuote(text, issueMatch),
      readability: "clear",
      injection_attempt: INJECTION_RE.test(text),
      flags,
    };
  }
}
