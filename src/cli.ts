import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { config } from "dotenv";
import { checkFile } from "./engine.js";
import { ClaudeExtractor, type Extractor } from "./extractor.js";
import { HeuristicExtractor } from "./heuristic.js";
import { ClientRules } from "./rules.js";
import { loadWorkerFile } from "./worker-file.js";

const USAGE = `usage: npm run check -- <worker folder...> [--rules file.yaml] [--offline] [--today YYYY-MM-DD] [-o dir]

  --rules     client rules (yaml or json)
  --offline   regex extractor instead of claude, no api key needed
  --today     reference date for expiry checks
  -o, --out   write one <folder>.json per worker file instead of printing`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      rules: { type: "string" },
      offline: { type: "boolean", default: false },
      today: { type: "string" },
      out: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help || positionals.length === 0) {
    console.log(USAGE);
    process.exit(values.help ? 0 : 1);
  }
  if (values.today && !/^\d{4}-\d{2}-\d{2}$/.test(values.today)) throw new Error("--today must be YYYY-MM-DD");

  config({ quiet: true });
  const rules = values.rules ? await ClientRules.load(values.rules) : null;
  const extractor: Extractor = values.offline
    ? new HeuristicExtractor(rules?.flagKeywords())
    : new ClaudeExtractor();

  for (const folder of positionals) {
    const start = performance.now();
    const report = await checkFile(await loadWorkerFile(folder), extractor, rules, values.today);
    const secs = ((performance.now() - start) / 1000).toFixed(1);
    const json = JSON.stringify(report, null, 2);

    if (values.out) {
      await mkdir(values.out, { recursive: true });
      await writeFile(path.join(values.out, `${path.basename(folder)}.json`), json + "\n");
      console.log(`${path.basename(folder)}: ${report.verdict} (confidence ${report.confidence}, ${secs}s)`);
    } else {
      console.log(json);
    }
  }

  if (extractor instanceof ClaudeExtractor) console.error(`llm usage: ${JSON.stringify(extractor.usage)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
