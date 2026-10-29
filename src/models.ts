import { z } from "zod";

export const DocType = z.enum(["pasi", "caces", "driving_licence", "h0b0", "atex", "other"]);
export type DocType = z.infer<typeof DocType>;

export const Verdict = z.enum(["compliant", "non_compliant", "needs_human_review"]);
export type Verdict = z.infer<typeof Verdict>;

// worst first
const VERDICT_ORDER: Verdict[] = ["non_compliant", "needs_human_review", "compliant"];

export function worst(verdicts: Verdict[]): Verdict {
  return VERDICT_ORDER.find((v) => verdicts.includes(v)) ?? "compliant";
}

export const Worker = z.object({
  first_name: z.string(),
  last_name: z.string(),
  // what the worker will do on the mission, matched by client rules
  assignment: z.array(z.string()).default([]),
  // type each attachment was uploaded as
  declared_documents: z.record(z.string(), DocType).default({}),
});
export type Worker = z.infer<typeof Worker>;

export const fullName = (w: Worker) => `${w.first_name} ${w.last_name}`;

export interface Evidence {
  document?: string;
  page?: number;
  quote?: string;
}

export interface CheckResult {
  check: string;
  verdict: Verdict;
  reason: string;
  confidence: number;
  evidence: Evidence[];
}

export interface DocumentReport {
  file: string;
  detected_type: DocType;
  holder_name: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  verdict: Verdict;
  confidence: number;
  reasons: string[];
  checks: CheckResult[];
}

export interface FileReport {
  worker: string;
  client: string | null;
  verdict: Verdict;
  confidence: number;
  reasons: string[];
  documents: DocumentReport[];
  file_checks: CheckResult[];
}
