# Design

## Architecture

```
worker folder -> pdf.ts (text per page, scan detection)
              -> extractor (LLM, 1 call per document, structured JSON)
              -> checks.ts (standard rules)  + rules.ts (client rules)   <- plain code
              -> aggregation: worst verdict wins, confidence = min
```

The main choice: **the LLM extracts, code decides.** Claude returns facts
(type, holder, dates, readability, answers to the client's yes/no questions) with
verbatim quotes and page numbers. Expiry, name matching, max age and aggregation are
deterministic TypeScript, unit tested, and explainable to an auditor. The model never
outputs "compliant".

Rule engine: client rules are YAML, validated with zod (discriminated union on
`kind`). `require_document` covers "assignment X needs a valid doc of type Y (max N
years)", `semantic_flag` covers fuzzy things ("anything suggesting labour lending")
by injecting the question into the extraction prompt. *"A client adds a rule
tomorrow"*: if it fits an existing kind, it's a YAML change, no deploy. If not, we add a
kind (one schema + one evaluate function), then it's config for every tenant after that.

Uncertainty is first class: illegible scan, low type confidence, missing date or name,
near-miss name (OCR typo), low-confidence flag, model refusal, or exception all give
`needs_human_review`, never a silent pass.

## Model choice

Claude via the Anthropic TypeScript SDK, structured outputs (`messages.parse` + zod), so
no JSON parsing hacks. Text PDFs are sent as text (cheaper, and quotes stay exact). PDFs with a
scanned page are sent as a PDF document block, so Claude reads the page images. Default is `claude-opus-5-5` at low effort. Measured on the samples:

| model | detection precision | doc verdict acc. | cost / doc | latency / file* |
|---|---|---|---|---|
| opus-5-5 (3 runs) | 100% | 100% | $0.016 | 5.0 s |
| sonnet-5-5 (2 runs) | 100% | 100% | $0.008 | 3.4 s |
| haiku-5-5 (2 runs) | 100% | 100% | $0.0005 | 4.3 s |

\* documents of a file are processed in parallel. ~2.5k input tokens/doc.

Haiku is about 30x cheaper for the same score here. With a bigger eval set I'd expect a gap on
real scans, so in production: Haiku first, escalate to Opus when a check has confidence
below a threshold or the page is a scan. Ollama with a local model also works behind the
same `Extractor` interface (data never leaves the infra), but vision quality on bad scans
is the risk.

## Evaluation

`npm run eval` (scripts/evaluate.ts) runs the pipeline on hand-labelled samples (`samples/expected.json`)
and reports detection precision per type, document and file verdict accuracy, latency and cost.
`--runs N` checks stability (LLM output is not deterministic). Honest caveat: 8 synthetic
documents are far too few to claim 95% precision. Next: 200+ documents per type,
anonymised real layouts, stratified by quality (photo, scan, multi-page), with an eval
gate in CI on every prompt or model change. Track precision of `compliant` separately,
because a false "compliant" is the costly error. A false "needs review" just costs HR time.

## Risks

- **Hallucinations**: the schema forces null when a field is absent, every fact carries a
  verbatim quote. Next step: verify the quote really exists in the page text, and
  downgrade to review if not. Dates are re-validated in code.
- **Prompt injection inside PDFs**: document text goes in a `<document>` block declared
  untrusted, and the model reports `injection_attempt` (the sample with hidden white text
  is caught). Since the model doesn't produce the verdict, an injection can at worst
  falsify extracted fields, and the suspicious flag forces human review. Also worth
  doing: strip invisible text (white or 1pt) before sending.
- **GDPR / PII**: documents contain names, birth dates, licence numbers. Use an EU or
  zero-retention API setup with a DPA, or a self-hosted model for strict tenants. Don't log document
  content, keep results only as long as the file, and minimise what is sent (no need for
  full birth date). The AI Act may class HR screening as high risk: keep the human in the loop
  and log the evidence per decision.

## Scaling to thousands of files and many tenants

- Queue based: upload -> object storage -> one job per document (extraction is
  independent per doc) -> aggregation job per file. Workers scale horizontally, with
  retries and rate-limit aware concurrency per API key.
- Batch API (-50%) for non-urgent backlogs. Prompt caching on the system prompt
  + tenant questions. Cache extraction by file hash (the same PASI is uploaded for
  many missions).
- Tenant rules stored in DB (versioned, validated against the same zod schema),
  and each report stores the rule version used. Extraction is mostly tenant independent,
  except semantic flags, so a rule change can be replayed on past extractions without
  calling the LLM again.
- Observability: verdict distribution per tenant and per doc type, review rate, override
  rate by HR (that's the real accuracy signal), cost per file.
