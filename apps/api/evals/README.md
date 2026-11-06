# RAG Evaluations

Evaluate the system in layers. A plausible answer can hide incorrect retrieval,
missing citations, or unsafe behavior when a malicious document is present.

## 1. Prompt-injection regression suite

`security/prompt-injection.v1.json` contains attacks and benign controls for the
deterministic ingestion scanner. Run it whenever the scanner or the ingestion
pipeline changes:

```bash
npm run eval:security
```

A passing result means the current classifier did not regress on these cases. It
does not prove general model safety. Add multilingual, Unicode, remote-content,
and real-domain variations, and record both blocked attacks and false positives.

## 2. Deterministic golden set

`golden-set.v1.json` stores questions and the sources expected in retrieval. It
measures retrieval without relying on another model's opinion.

```bash
npm run eval:golden
```

The report measures `hitRate` (was the expected source in top-K?) and `MRR` (how
early did it appear?). Version the set as it evolves and compare reports before
changing chunk size, embedding model, reranking, or a relevance threshold.

### CI mode

```bash
npm run eval:golden:ci
```

CI reads `corpus-manifest.v1.json`, chunks test files, and uses local lexical
retrieval. It does not call a paid model, remote database, or external service.
It protects the test corpus, golden-set shape, and harness logic. `eval:golden`
remains the integration evaluation for the actual pgvector and embedding setup.

## 3. Promptfoo

Promptfoo provides adversarial and prompt-regression tests. The repository uses a
local JavaScript provider so the default gate does not send documents, prompts,
or keys to a third party:

```bash
npm run eval:promptfoo
```

When adding hosted red teaming, use a test API with synthetic data, a fixed
budget, and uncommitted secrets. Test cross-tenant exfiltration, source-free
answers, tool-use requests inside retrieved text, and conflicting instructions.

## 4. Ragas and answer quality

Ragas complements the golden set with context precision, context recall, and
faithfulness. Use it after you have reference answers or a clearly defined judge.
Prepare rows with `question`, `answer`, `contexts`, and when relevant,
`ground_truth`. Inspect the lowest-scoring cases rather than treating one metric
as an approval decision.

The academic HarmBench benchmark can inform broader model-safety research, but
it does not replace product-specific retrieval and injection evaluations. For
this application, Promptfoo plus versioned real-world cases is the practical
starting point.
