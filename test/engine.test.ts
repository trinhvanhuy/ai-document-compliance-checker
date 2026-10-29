// end to end on the samples with the offline extractor (no api calls)
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { checkFile } from "../src/engine.js";
import { ExtractionError, type Extractor } from "../src/extractor.js";
import { HeuristicExtractor } from "../src/heuristic.js";
import { ClientRules } from "../src/rules.js";
import { loadWorkerFile } from "../src/worker-file.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const TODAY = "2026-10-29";
let rules: ClientRules;

beforeAll(async () => {
  rules = await ClientRules.load(path.join(ROOT, "rules", "nordis_chimie.yaml"));
});

async function run(folder: string, extractor?: Extractor) {
  const wf = await loadWorkerFile(path.join(ROOT, "samples", folder));
  return checkFile(wf, extractor ?? new HeuristicExtractor(rules.flagKeywords()), rules, TODAY);
}

describe("checkFile", () => {
  it("compliant worker", async () => {
    expect((await run("worker_01_marchand")).verdict).toBe("compliant");
  });

  it("expired + wrong type + atex too old", async () => {
    const report = await run("worker_02_benali");
    expect(report.verdict).toBe("non_compliant");
    const docs = Object.fromEntries(report.documents.map((d) => [d.file, d]));
    expect(docs["caces.pdf"]?.verdict).toBe("non_compliant");
    expect(docs["permis.pdf"]?.verdict).toBe("non_compliant");
    expect(report.file_checks.find((c) => c.check.includes("atex"))?.verdict).toBe("non_compliant");
  });

  it("extraction errors end up in human review", async () => {
    const broken: Extractor = {
      extract: async () => {
        throw new ExtractionError("refused");
      },
    };
    const report = await run("worker_01_marchand", broken);
    expect(report.documents.every((d) => d.verdict === "needs_human_review")).toBe(true);
    expect(report.verdict).not.toBe("compliant");
  });
});
