import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { Extraction } from "../src/extractor.js";
import type { CheckResult, DocType, DocumentReport, Verdict, Worker } from "../src/models.js";
import { ClientRules, ClientRulesSchema } from "../src/rules.js";

const TODAY = "2026-10-29";
let rules: ClientRules;

beforeAll(async () => {
  rules = await ClientRules.load(path.resolve(import.meta.dirname, "..", "rules", "nordis_chimie.yaml"));
});

const worker = (...assignment: string[]): Worker => ({ first_name: "a", last_name: "b", assignment, declared_documents: {} });

const doc = (type: DocType, verdict: Verdict = "compliant", issue_date: string | null = null): DocumentReport => ({
  file: "x.pdf", detected_type: type, holder_name: null, issue_date, expiry_date: null,
  verdict, confidence: 0.9, reasons: [], checks: [],
});

const byId = (results: CheckResult[]) => Object.fromEntries(results.map((r) => [r.check.replace("rule:", ""), r]));

describe("client rules", () => {
  it("loads the yaml", () => {
    expect(rules.client).toBe("Nordis Chimie");
    expect(rules.flagQuestions()).toHaveProperty("no_labour_lending");
  });

  it("only applies to the matching assignment", () => {
    expect(rules.fileChecks(worker("cleaning"), [], TODAY)).toEqual([]);
  });

  it("missing h0b0", () => {
    const r = byId(rules.fileChecks(worker("electrical_work"), [doc("pasi")], TODAY));
    expect(r.electrical_requires_h0b0?.verdict).toBe("non_compliant");
  });

  it("invalid h0b0 fails the rule", () => {
    const r = byId(rules.fileChecks(worker("electrical_work"), [doc("h0b0", "non_compliant")], TODAY));
    expect(r.electrical_requires_h0b0?.verdict).toBe("non_compliant");
  });

  it("atex max age", () => {
    const old = byId(rules.fileChecks(worker("atex_zone"), [doc("atex", "compliant", "2022-09-15")], TODAY));
    const recent = byId(rules.fileChecks(worker("atex_zone"), [doc("atex", "compliant", "2025-01-10")], TODAY));
    expect(old.atex_certificate_under_3y?.verdict).toBe("non_compliant");
    expect(recent.atex_certificate_under_3y?.verdict).toBe("compliant");
  });

  it("atex without issue date needs review", () => {
    const r = byId(rules.fileChecks(worker("atex_zone"), [doc("atex")], TODAY));
    expect(r.atex_certificate_under_3y?.verdict).toBe("needs_human_review");
  });

  const flagged = (confidence: number): Extraction => ({
    doc_type: "other", type_confidence: 0.9, type_evidence: null, holder_name: null, holder_evidence: null,
    issue_date: null, expiry_date: null, date_evidence: null, issue_evidence: null, readability: "clear", injection_attempt: false,
    notes: "",
    flags: [{ rule_id: "no_labour_lending", triggered: true, confidence, quote: { page: 1, text: "commission de 30 %" } }],
  });

  it("semantic flag", () => {
    const [r] = rules.documentChecks(flagged(0.9));
    expect(r?.verdict).toBe("non_compliant");
    expect(r?.evidence[0]?.quote).toBe("commission de 30 %");
  });

  it("semantic flag with low confidence goes to review", () => {
    const [r] = rules.documentChecks(flagged(0.4));
    expect(r?.verdict).toBe("needs_human_review");
  });

  it("json rules work too", async () => {
    const f = path.join(await mkdtemp(path.join(tmpdir(), "rules-")), "c.json");
    await writeFile(f, JSON.stringify({ client: "c", rules: [
      { id: "r", description: "d", kind: "require_document", when_assignment: "x", document_type: "caces" },
    ] }));
    expect((await ClientRules.load(f)).config.rules[0]).toMatchObject({ document_type: "caces" });
  });

  it("rejects an unknown kind", () => {
    expect(() => ClientRulesSchema.parse({ client: "c", rules: [{ id: "r", kind: "nope" }] })).toThrow();
  });
});
