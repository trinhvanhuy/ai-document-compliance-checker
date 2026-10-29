import { standardChecks } from "./checks.js";
import { ExtractionError, type Extraction, type Extractor } from "./extractor.js";
import { fullName, isIsoDate, worst, type CheckResult, type DocumentReport, type FileReport } from "./models.js";
import type { PdfDocument } from "./pdf.js";
import type { ClientRules } from "./rules.js";
import type { WorkerFile } from "./worker-file.js";

const isoOrNull = (s: string | null) => (isIsoDate(s) ? s : null);

// documents are French, "today" is the Paris date, not UTC (they differ around midnight)
export const todayInParis = (now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });

const reasonsOf = (checks: CheckResult[]) => {
  const bad = checks.filter((c) => c.verdict !== "compliant").map((c) => c.reason);
  return bad.length ? bad : ["all checks passed"];
};

const round = (n: number) => Math.round(n * 100) / 100;

function failedDoc(doc: PdfDocument, reason: string): DocumentReport {
  return {
    file: doc.name,
    detected_type: "other",
    holder_name: null,
    issue_date: null,
    expiry_date: null,
    verdict: "needs_human_review",
    confidence: 0,
    reasons: [reason],
    checks: [{ check: "readable", verdict: "needs_human_review", reason, confidence: 0, evidence: [] }],
  };
}

export function buildDocumentReport(
  doc: PdfDocument,
  ex: Extraction,
  wf: WorkerFile,
  rules: ClientRules | null,
  today: string,
): DocumentReport {
  const checks = [
    ...standardChecks(ex, wf.worker, wf.worker.declared_documents[doc.name], today),
    ...(rules?.documentChecks(ex) ?? []),
  ];
  if (doc.totalPages) {
    const reason = `only the first ${doc.pages.length} of ${doc.totalPages} pages were read`;
    checks.push({ check: "complete", verdict: "needs_human_review", reason, confidence: 0.5, evidence: [] });
  }
  for (const c of checks) for (const e of c.evidence) e.document = doc.name;

  return {
    file: doc.name,
    detected_type: ex.doc_type,
    holder_name: ex.holder_name,
    issue_date: isoOrNull(ex.issue_date),
    expiry_date: isoOrNull(ex.expiry_date),
    verdict: worst(checks.map((c) => c.verdict)),
    confidence: round(Math.min(...checks.map((c) => c.confidence))),
    reasons: reasonsOf(checks),
    checks,
  };
}

export async function checkDocument(
  doc: PdfDocument,
  wf: WorkerFile,
  extractor: Extractor,
  rules: ClientRules | null,
  today: string,
): Promise<DocumentReport> {
  if (doc.error) return failedDoc(doc, doc.error);
  let ex: Extraction;
  try {
    ex = await extractor.extract(doc, rules?.flagQuestions() ?? {});
  } catch (e) {
    if (e instanceof ExtractionError) return failedDoc(doc, e.message);
    console.error(`extraction failed for ${doc.name}:`, e);
    return failedDoc(doc, "extraction failed, see logs");
  }
  return buildDocumentReport(doc, ex, wf, rules, today);
}

export async function checkFile(
  wf: WorkerFile,
  extractor: Extractor,
  rules: ClientRules | null = null,
  today = todayInParis(),
): Promise<FileReport> {
  // documents are independent, run them in parallel
  const docs = await Promise.all(wf.documents.map((d) => checkDocument(d, wf, extractor, rules, today)));
  const fileChecks = rules?.fileChecks(wf.worker, docs, today) ?? [];

  const reasons = [
    ...docs.filter((d) => d.verdict !== "compliant").flatMap((d) => d.reasons.map((r) => `${d.file}: ${r}`)),
    ...fileChecks.filter((c) => c.verdict !== "compliant").map((c) => c.reason),
  ];
  const confidences = [...docs.map((d) => d.confidence), ...fileChecks.map((c) => c.confidence)];

  return {
    worker: fullName(wf.worker),
    client: rules?.client ?? null,
    verdict: worst([...docs.map((d) => d.verdict), ...fileChecks.map((c) => c.verdict)]),
    confidence: confidences.length ? round(Math.min(...confidences)) : 0,
    reasons: reasons.length ? reasons : ["all documents and client rules passed"],
    documents: docs,
    file_checks: fileChecks,
  };
}
