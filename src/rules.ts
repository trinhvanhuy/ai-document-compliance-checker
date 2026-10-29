/**
 * Client specific rules, loaded from a yaml/json file.
 *
 * Two kinds for now:
 * - require_document: an assignment needs a valid document of some type
 *   (optionally younger than N years)
 * - semantic_flag: a yes/no question asked to the LLM about every document
 *
 * A new rule of an existing kind = a few lines of config. A new *kind* is a
 * new schema + evaluate function here.
 */
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { Extraction } from "./extractor.js";
import { DocType, Verdict, type CheckResult, type DocumentReport, type Worker } from "./models.js";

const RequireDocument = z.object({
  id: z.string(),
  description: z.string(),
  kind: z.literal("require_document"),
  when_assignment: z.string(),
  document_type: DocType,
  max_age_years: z.number().positive().optional(),
  severity: Verdict.default("non_compliant"),
});
type RequireDocument = z.infer<typeof RequireDocument>;

const SemanticFlag = z.object({
  id: z.string(),
  description: z.string(),
  kind: z.literal("semantic_flag"),
  question: z.string(),
  keywords: z.array(z.string()).default([]), // only used by the offline extractor
  min_confidence: z.number().min(0).max(1).default(0.7),
  severity: Verdict.default("non_compliant"),
});
type SemanticFlag = z.infer<typeof SemanticFlag>;

export const ClientRulesSchema = z.object({
  client: z.string(),
  rules: z.array(z.discriminatedUnion("kind", [RequireDocument, SemanticFlag])).default([]),
});
export type ClientRulesConfig = z.infer<typeof ClientRulesSchema>;

const ORDER: Verdict[] = ["compliant", "needs_human_review", "non_compliant"];
const YEAR_MS = 365.25 * 24 * 3600 * 1000;

function evaluateRequireDocument(rule: RequireDocument, docs: DocumentReport[], today: string): CheckResult {
  const res = (verdict: Verdict, reason: string, doc?: DocumentReport): CheckResult => ({
    check: `rule:${rule.id}`,
    verdict,
    reason: `${rule.description} -> ${reason}`,
    confidence: doc?.confidence ?? 1,
    evidence: doc ? [{ document: doc.file }] : [],
  });

  const candidates = docs.filter((d) => d.detected_type === rule.document_type);
  if (candidates.length === 0) return res(rule.severity, `no ${rule.document_type} document in the file`);

  // take the best candidate, a file can contain an old and a new certificate
  const best = [...candidates].sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict))[0]!;
  if (best.verdict === "needs_human_review") return res("needs_human_review", `${best.file} needs review`, best);
  if (best.verdict === "non_compliant") {
    return res(rule.severity, `${best.file} is not valid: ${best.reasons.join("; ")}`, best);
  }

  if (rule.max_age_years !== undefined) {
    if (!best.issue_date) return res("needs_human_review", `issue date of ${best.file} unknown, can't check age`, best);
    const age = (Date.parse(today) - Date.parse(best.issue_date)) / YEAR_MS;
    if (age > rule.max_age_years) {
      return res(
        rule.severity,
        `${best.file} issued ${best.issue_date} (${age.toFixed(1)}y old), max ${rule.max_age_years}y`,
        best,
      );
    }
  }
  return res("compliant", `valid ${rule.document_type}: ${best.file}`, best);
}

function evaluateFlag(rule: SemanticFlag, ex: Extraction): CheckResult | null {
  const answer = ex.flags.find((f) => f.rule_id === rule.id);
  if (!answer?.triggered) return null;
  const evidence = answer.quote ? [{ page: answer.quote.page ?? undefined, quote: answer.quote.text }] : [];
  if (answer.confidence < rule.min_confidence) {
    return {
      check: `rule:${rule.id}`,
      verdict: "needs_human_review",
      reason: `${rule.description} -> possible match, low confidence`,
      confidence: answer.confidence,
      evidence,
    };
  }
  return { check: `rule:${rule.id}`, verdict: rule.severity, reason: rule.description, confidence: answer.confidence, evidence };
}

export class ClientRules {
  constructor(readonly config: ClientRulesConfig) {}

  static async load(file: string): Promise<ClientRules> {
    const raw = await readFile(file, "utf8");
    const data = file.endsWith(".json") ? JSON.parse(raw) : parseYaml(raw);
    return new ClientRules(ClientRulesSchema.parse(data));
  }

  get client() {
    return this.config.client;
  }

  private get flags() {
    return this.config.rules.filter((r): r is SemanticFlag => r.kind === "semantic_flag");
  }

  flagQuestions(): Record<string, string> {
    return Object.fromEntries(this.flags.map((r) => [r.id, r.question.trim()]));
  }

  flagKeywords(): Record<string, string[]> {
    return Object.fromEntries(this.flags.map((r) => [r.id, r.keywords]));
  }

  /** Rules evaluated on each document (semantic flags). */
  documentChecks(ex: Extraction): CheckResult[] {
    return this.flags.map((f) => evaluateFlag(f, ex)).filter((r): r is CheckResult => r !== null);
  }

  /** Rules evaluated on the whole file, once every document has its report. */
  fileChecks(worker: Worker, docs: DocumentReport[], today: string): CheckResult[] {
    return this.config.rules
      .filter((r): r is RequireDocument => r.kind === "require_document")
      .filter((r) => worker.assignment.includes(r.when_assignment))
      .map((r) => evaluateRequireDocument(r, docs, today));
  }
}
