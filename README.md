# ai-document-compliance-checker

Prototype for the Pixid homework: take a temp worker file (a folder of PDFs),
return a compliance verdict per document and per file, with reasons,
confidence and evidence (page + quote).

Design notes, eval, cost and risks: see [DESIGN.md](DESIGN.md).

## Run it (< 5 min)

Node 20+ (`.nvmrc` says 22).

```bash
npm ci
cp .env.example .env          # put your ANTHROPIC_API_KEY in it

# check the 3 sample worker files against the sample client rules
npm run check -- samples/worker_0* --rules rules/nordis_chimie.yaml --today 2026-10-29 -o results/

# same without any API key (regex extractor, only knows the sample layouts)
npm run check -- samples/worker_0* --rules rules/nordis_chimie.yaml --today 2026-10-29 --offline

npm test            # vitest, no network
npm run typecheck
```

`--today` pins the reference date so the sample results are reproducible,
drop it to use the real date (Paris time). Without `-o` the JSON report goes to stdout.
Exit code: `0` all compliant, `2` at least one non_compliant, `3` needs human review, `1` error,
so it can be used in a batch script.

Other model: `ANTHROPIC_MODEL=claude-haiku-5-5 npm run check -- ...`

## Input

A worker file is a folder:

```
samples/worker_02_benali/
  worker.json      # name, assignment tags, declared type of each attachment
  atex.pdf
  caces.pdf
  permis.pdf
```

`declared_documents` is the type the attachment was uploaded as (what the
temp agency says it is). The checker compares it with what it actually finds.
Only PDFs are read for now: any other file (phone photo...) or a declared file that is
missing still shows up in the report, as `needs_human_review`.

## Output

One JSON per worker file (see [results/](results/)):

```json
{
  "worker": "Sofia Benali",
  "client": "Nordis Chimie",
  "verdict": "non_compliant",
  "confidence": 0.97,
  "reasons": ["caces.pdf: expired on 2025-06-30", "..."],
  "documents": [
    {"file": "caces.pdf", "detected_type": "caces", "verdict": "non_compliant",
     "checks": [{"check": "not_expired", "verdict": "non_compliant",
                 "evidence": [{"page": 1, "quote": "Date de fin de validite : 30/06/2025", "document": "caces.pdf"}]}]}
  ],
  "file_checks": ["client rules evaluated on the whole file"]
}
```

Verdicts: `compliant`, `non_compliant`, `needs_human_review`. The worst one wins
(document -> file).

## Client rules

[rules/nordis_chimie.yaml](rules/nordis_chimie.yaml), YAML or JSON, validated with zod. Two kinds today:

```yaml
- id: atex_certificate_under_3y
  description: ATEX zone assignments require an ATEX certificate under 3 years old.
  kind: require_document
  when_assignment: atex_zone
  document_type: atex
  max_age_years: 3

- id: no_labour_lending
  description: Flag any file suggesting illegal labour lending.
  kind: semantic_flag
  question: Does this document suggest illegal labour lending ...?
  min_confidence: 0.7
```

`semantic_flag` questions are sent to the LLM with every document, so a new
"flag anything that looks like X" rule is only config.

## Samples

8 synthetic PDFs, 3 workers, all names and companies made up
(`npm run samples` regenerates them, output is deterministic). Traps:

| file | trap |
|---|---|
| worker_02 / caces.pdf | expired |
| worker_02 / permis.pdf | uploaded as driving licence, is a garage invoice |
| worker_02 / atex.pdf | valid but 4 years old -> client rule (max 3y) |
| worker_03 / h0b0.pdf | wrong name (Kevin Lefort vs Karim Lefevre) |
| worker_03 / pasi_scan.pdf | blurry, noisy, rotated scan, no text layer |
| worker_03 / convention.pdf | labour lending + hidden prompt injection (white 1pt text) |

Expected labels are in [samples/expected.json](samples/expected.json),
`npm run eval` scores the pipeline against them.

## Layout

```
src/
  pdf.ts          pdf -> text per page (unpdf), scan detection
  extractor.ts    claude: classify + extract fields + answer rule questions (structured output, zod)
  heuristic.ts    offline regex extractor
  checks.ts       standard Pixid checks (readable, type, expiry, name)
  verify.ts       evidence quotes must exist in the pdf text
  rules.ts        client rule engine
  engine.ts       glue + aggregation
  cli.ts
scripts/          sample generator, evaluation
test/             vitest
```

## What I'd do next

- Bigger labelled set (real-looking layouts, phone photos, multi page, several docs merged in one pdf)
  before trusting any accuracy number. 8 docs proves the pipeline, not the precision.
- Haiku first, escalate to Opus only when confidence is low or the doc is a scan (see DESIGN.md).
- Split a pdf containing several documents (very common in real uploads).
- Read jpg/png attachments (send them as image blocks), and OCR scans so their quotes can be verified too.
- Verify issuers (CACES testing bodies, ATEX centers) against a reference list.
- Rules: an `any_of` / `all_of` combinator, per-tenant rule versioning, and a dry-run
  mode to replay a new rule on past files before enabling it.
- Small HTTP API (upload a file, get the report) + a review screen for HR, with their
  corrections feeding back into the eval set.
