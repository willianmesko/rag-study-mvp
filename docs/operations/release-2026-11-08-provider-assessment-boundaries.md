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

Implementation and local validation are complete; CI/publication are pending.
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
