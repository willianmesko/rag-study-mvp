# RAG Evaluations

Evaluate the system in layers. A plausible answer can hide incorrect retrieval,
missing citations, or unsafe behavior when a malicious document is present.

## Evaluation harness

The repository includes a deterministic quality harness that runs type checking,
unit tests, production builds, prompt-injection regression, golden-set retrieval,
versioned replay regression, and Promptfoo security checks as one release gate.

```bash
npm run eval:harness
```

The harness stops at the first failed check, exits with a non-zero status, and
can write a machine-readable report for CI or local inspection:

```bash
npm run eval:harness -- --report reports/evaluation-history/latest.json
```

Promptfoo currently requires Node.js 22.22 or newer. On an older local runtime,
you can still run the deterministic checks while keeping the omission explicit:

```bash
npm run eval:harness -- --skip-promptfoo
```

CI remains configured with Node.js 24 and always runs Promptfoo.

Reports intentionally contain metrics, statuses, durations, and commit metadata;
they do not persist document text, questions, prompts, or provider secrets.

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

## 4. Answer quality in the workspace

**Context precision** uses ranked average precision against reviewed passage
anchors from the public reference document. It evaluates prompt-safe evidence
retrieved in the workspace. The workspace must have the benchmark reference
indexed for this score to be meaningful. Inspect hit rate and MRR alongside it.

**Faithfulness** scores the share of generated claims supported by the supplied
passages. When `EVAL_FAITHFULNESS_JUDGE_MODEL` and an OpenRouter key are
configured, an owner can explicitly choose this evaluation and an allowlisted
answer model. The judge first checks a supported and unsupported example. It
then evaluates the bundled public cases with a time and request budget. The
dashboard shows coverage and leaves the score unavailable if calibration or
any case fails. The judge receives public fixture passages and answers generated
from those fixtures. The regular workspace evaluation does not send its retrieved
content to the judge. Use the result as a sample-based quality signal.

Metric definitions follow the [Ragas faithfulness guide](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/)
and [context precision guide](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_precision/).

The academic HarmBench benchmark can inform broader model-safety research, but
it does not replace product-specific retrieval and injection evaluations. For
this application, Promptfoo plus versioned real-world cases is the practical
starting point.

## 5. Reviewed replays and regression gates

The default suite contains six synthetic cases in Portuguese and English with
reviewed relevant passages and distractors. The offline benchmark uses lexical
ordering of fixed candidate sets. It measures top-K hit rate, MRR, recall,
precision, and ranked context precision. The security fixture contributes attack
detection recall, detection precision, and benign false-positive rate. Flagged
means medium or high scanner risk. The existing gate also checks the exact risk
level in each security case.

```bash
npm run eval:regression
npm run eval:replay -- --report reports/evaluation-history/replay-current.json
npm run eval:replay -- --baseline reports/evaluation-history/replay-previous.json
```

CI compares `baseline.v1.json` against the current code. The fingerprints must
match, and the comparison fails when a quality metric drops or false positives
increase. For a planned dataset revision, review the labels and report before
committing a new baseline. The reports contain metrics and opaque case IDs.

To replay a reviewed production scenario, recreate the question and necessary
passages with invented entities and values. Remove original names, unique facts,
URLs, timestamps, account identifiers, workspace identifiers, and any data that
could identify the original case. Have someone review the fixture, mark its cases
`reviewed-anonymized`, and keep the source file outside the repository. The CLI
rejects common detected personal identifiers. This is an extra check on top of
the review.

```bash
npm run eval:replay -- --suite /path/to/reviewed-replay.json
```

## 6. Compare Jina against the reviewed candidates

```bash
npm run eval:jina -- --report reports/evaluation-history/jina-current.json
```

This explicit command requires `JINA_API_KEY`. It sends only the bundled
synthetic suite to the [Jina Reranker API](https://jina.ai/reranker/), with the
same safe candidates and K used by the local comparison. It reports quality
metrics for both orderings and the extra reranking time per case. Custom replay
files cannot be sent to Jina through this command. Keep production reranking
disabled until you have reviewed the live comparison.
