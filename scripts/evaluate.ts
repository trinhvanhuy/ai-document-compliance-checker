/**
 * Compare the pipeline output with samples/expected.json.
 *
 *   npm run eval                    # claude, 1 run
 *   npm run eval -- --runs 3        # check stability across runs
 *   npm run eval -- --offline
 *
 * Prints detection precision per type, verdict accuracy (doc + file),
 * latency and token cost.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { config } from "dotenv";
import { checkFile } from "../src/engine.js";
import { ClaudeExtractor, type Extractor } from "../src/extractor.js";
import { HeuristicExtractor } from "../src/heuristic.js";
import { ClientRules } from "../src/rules.js";
import { loadWorkerFile } from "../src/worker-file.js";

const ROOT = path.resolve(import.meta.dirname, "..");

// $ per million tokens (input, output)
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

interface Expected {
  verdict: string;
  documents: Record<string, { type: string; verdict: string }>;
}

const { values } = parseArgs({
  options: {
    runs: { type: "string", default: "1" },
    offline: { type: "boolean", default: false },
    rules: { type: "string", default: path.join(ROOT, "rules", "nordis_chimie.yaml") },
    today: { type: "string", default: "2026-10-29" },
    out: { type: "string", short: "o", default: path.join(ROOT, "results", "eval.json") },
  },
});

config({ path: path.join(ROOT, ".env"), quiet: true });
const { _note, ...expected } = JSON.parse(await readFile(path.join(ROOT, "samples", "expected.json"), "utf8")) as Record<
  string,
  Expected
>;
const rules = await ClientRules.load(values.rules);
const extractor: Extractor = values.offline ? new HeuristicExtractor(rules.flagKeywords()) : new ClaudeExtractor();
const runs = Number(values.runs);

const predicted: Record<string, number> = {}; // predicted type -> count
const correct: Record<string, number> = {}; // predicted type -> correct count
let docOk = 0;
let docTotal = 0;
let fileOk = 0;
const errors: string[] = [];
const latencies: number[] = [];

for (let run = 0; run < runs; run++) {
  for (const [folder, exp] of Object.entries(expected)) {
    const start = performance.now();
    const report = await checkFile(await loadWorkerFile(path.join(ROOT, "samples", folder)), extractor, rules, values.today);
    latencies.push((performance.now() - start) / 1000);

    if (report.verdict === exp.verdict) fileOk++;
    else errors.push(`run ${run} ${folder}: file verdict ${report.verdict}, expected ${exp.verdict}`);

    for (const d of report.documents) {
      const e = exp.documents[d.file];
      if (!e) throw new Error(`no expected label for ${folder}/${d.file}`);
      predicted[d.detected_type] = (predicted[d.detected_type] ?? 0) + 1;
      if (d.detected_type === e.type) correct[d.detected_type] = (correct[d.detected_type] ?? 0) + 1;
      else errors.push(`run ${run} ${folder}/${d.file}: type ${d.detected_type}, expected ${e.type}`);

      docTotal++;
      if (d.verdict === e.verdict) docOk++;
      else errors.push(`run ${run} ${folder}/${d.file}: verdict ${d.verdict}, expected ${e.verdict}`);
    }
  }
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const totalCorrect = Object.values(correct).reduce((a, b) => a + b, 0);
const nFiles = Object.keys(expected).length * runs;

const result: Record<string, unknown> = {
  extractor: extractor instanceof ClaudeExtractor ? extractor.model : "offline",
  runs,
  documents: docTotal,
  detection_precision_micro: r3(totalCorrect / docTotal),
  detection_precision_per_type: Object.fromEntries(
    Object.keys(predicted)
      .sort()
      .map((t) => [t, r3((correct[t] ?? 0) / predicted[t]!)]),
  ),
  document_verdict_accuracy: r3(docOk / docTotal),
  file_verdict_accuracy: r3(fileOk / nFiles),
  avg_latency_per_file_s: Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 100) / 100,
  errors,
};

if (extractor instanceof ClaudeExtractor && PRICES[extractor.model]) {
  const [pin, pout] = PRICES[extractor.model]!;
  const { input_tokens, output_tokens, calls } = extractor.usage;
  const cost = (input_tokens * pin + output_tokens * pout) / 1e6;
  result.usage = extractor.usage;
  result.cost_per_document_usd = Math.round((cost / calls) * 10000) / 10000;
  result.cost_per_file_usd = Math.round((cost / nFiles) * 10000) / 10000;
}

const json = JSON.stringify(result, null, 2);
console.log(json);
await mkdir(path.dirname(values.out), { recursive: true });
await writeFile(values.out, json + "\n");
