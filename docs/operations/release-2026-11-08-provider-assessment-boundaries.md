# BE-12 judge and reranker response boundaries

## Findings and plan

The OpenRouter faithfulness adapter throws raw JSON/Zod parser errors for model
verdicts, accepts multiple choices despite requesting one and checks the
16-claim ceiling after array item traversal. The Jina adapter also throws raw
Zod errors, validates array items before cardinality and accepts more results
than its requested `top_n`. Those are provider failures, not invalid client
requests. JSON syntax/unknown-field diagnostics may contain response fragments.

Decode unknown envelopes with existing Zod/native guards and fixed
`IntegrationFailure("invalid_response")` errors. Require one judge choice and
the existing 1–16 claims before traversing their items. Preserve the `stop`
completion requirement, exact quote bounds and strict verdict fields. Jina
results must be an array no longer than the requested maximum before item
validation; retain finite scores, valid unique candidate indexes and mapping
only to server-owned passages. Preserve an empty result and a no-candidate
short circuit. Reject an invalid internal result limit before HTTP.

The official [Jina contract](https://jina.ai/reranker/) defines `top_n` as the
maximum returned documents. This does not choose a newer reranker or impose a
new factual-confidence interpretation on scores. Requests, redaction, deadlines,
retry/cost reservations, model/prompt versions and native usage accounting stay
unchanged. Valid usage, including zero, must survive an invalid result; malformed
usage stays unknown. No new library or generic provider framework is justified.

## Acceptance and status

Implementation, validation and publication are complete at
`e3840b31a5c915aba4927d2ff38548711ba11a36`.
The adapters now use fixed invalid-response failures, one judge choice, a shared
16-claim ceiling and the requested rerank result maximum before item traversal.
They preserve native accounting independently of output validity.

Twenty-three focused cases passed with zero skips, including seven new cases
and existing request/redaction, provider registry/deadline/native usage and
conservative paid-reranker cases. All seven local harness checks passed after
the final shared-bound change. Both graphs are clean (450 structural modules /
1,782 edges and 449 runtime modules / 1,289 edges). Checks cover bad JSON,
envelopes, finish reasons, batch/claim limits, indexes, duplicates and scores,
plus usage retention and unchanged valid request/redaction behavior. The local
harness, provider deadline/usage/registry cases, conservative paid-reranker tests
and fresh database/UX/MCP gates remain required before publication. No real provider call, key,
pricing change or model activation is required. Jina's separate golden-set
quality comparison/activation remains pending.

## Published evidence

All four [quality gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42430999939)
passed: 410 UX cases/46 deliberate profile skips, 88 actual PostgreSQL cases,
the isolated embedding cutover, 78 architecture fixtures, seven harness checks,
four native route-state cases, three artifact cases, three payload cases and the
actual five-tool read-only MCP image. The Render build at 00:51:47 UTC passed
both real OCR cases with zero skips and reported 490 application files,
1,546,252 bytes, 14 supported entries and zero project test artifacts.

Both services were observed LIVE on 2026-11-08 at the exact source:

- API `dep-dbnsf32jnfac73d8n2ng`: 00:52:23.191220 UTC.
- Web `dep-dbnsf4brjlhs739o773g`: 00:52:18.878970 UTC.

The 00:59:02 UTC public check verified served entry/lazy/CSS assets and original
icon bytes, health/readiness, server-owned request correlation, protected routes,
S256/resource discovery and safe malformed request responses. The API error/fatal
window 00:52:23–01:03:22 UTC was empty. No private question, real Jina/judge call,
secret, model switch or hosted SQL operation was used for these checks.
