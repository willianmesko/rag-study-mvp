# BE-12 workflow budget and encrypted JSON boundaries

## Findings and bounded plan

The workflow snapshot mapper calls workflowBudgetSchema.parse on a stored JSON
budget. A corrupt budget therefore throws a raw ZodError, which the HTTP layer
uses for invalid client input. This misclassifies a persistence failure and can
include stored unknown key names in diagnostics. Reuse decodeStoredRecord for
this stored read only; keep admission/input validation and all budget ceilings,
SQL predicates, fencing and state transitions unchanged.

WorkflowStateCodec.parse decrypts authenticated bytes and calls JSON.parse
directly. An invalid JSON plaintext can appear in a native parser message.
Encryption authentication does not validate JSON syntax/encoding. Keep decode
outside the parser catch so missing-key/authentication errors retain their safe
diagnostics; decode JSON as strict UTF-8 and return one fixed, causeless parse
failure. This is a diagnostic/data-integrity safeguard, not a claim of an
encryption break or an unauthenticated writer.

Use existing Zod/native TextDecoder and the existing stored-record helper. No
key, dependency, cipher format, schema or configuration change is needed.
Unit cases cover absent/valid/corrupt snapshots, exact scoped bindings, malformed
authenticated JSON, invalid UTF-8 and preserved key/AAD rotation behavior. A real
SQL fixture must corrupt/restore only its own budget and prove connection reuse.
Existing workflow recovery, rotation, approval and replay gates remain required.

## Status

Implementation, validation and publication are complete at
`c8452e12240c8031733ac59a13f714568b79bd1d`. Eight focused cases passed without skips, including
three new stored-budget cases and one new codec case covering malformed JSON
and invalid UTF-8, plus preserved key/AAD/rotation and workflow-policy checks.
The final combined source passed all seven local harness checks; the optional
performance gate is unexecuted. The new disposable SQL case mutates only an
already completed fixture, restores it and creates no globally claimable queue
work. It is not claimed as run locally because the Docker VM is full.

The source also includes the separately documented BE-16 authentication fix.
Strict types initially identified a direct-controller fixture missing the new
explicit policy; that fixture now declares its intended non-production policy.
The complete harness passed after that correction; the failed attempt is not
counted as validation. Dependency, encryption key and hosted settings remain
unchanged. Fresh normal gates and the actual exact-source capacity pilot are
required before publication.

## Published evidence

All four [quality gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42436598494)
passed: 410 UX cases/46 deliberate profile skips, 90 actual PostgreSQL cases
without skips, the isolated cutover, 78 architecture fixtures, seven harness
checks, four native route-state, six artifact, eight capacity-fixture and three
payload cases. The separate exact-source [capacity pilot](https://github.com/willianmesko/rag-study-mvp/actions/runs/42436598528)
passed 104 scoped pairs, all six deduplicated ingestions and clean process exits.
Both dependency graphs passed (450 structural/1,786 edges; 449 runtime/1,293).
The actual API image applied 31 migrations and repeated zero against its own
fixture. Native OCR passed twice with zero skips, and both CI and the actual
Render build reported 490 files/1,549,859 bytes, 14 entry roots, zero project test
artifacts and the unchanged reviewed 31-file SQL catalog digest.

Both services were observed LIVE at the exact source on 2026-11-08:

- API `dep-dbntidff3r2c739k5qo0`: 02:08:43.891300 UTC.
- Web `dep-dbntienf3r2c739k5t9g`: 02:07:40.257665 UTC.

The public check at 02:09:24 UTC verified entry/lazy/CSS assets, original icon
bytes, health/readiness, correlation, protected routes, discovery and safe malformed
requests. An empty unauthenticated legacy write returned 401; no document,
quota/model admission, private question, hosted SQL or secret was used.

The first error-log query returned Render/Loki 503. A repeated bounded query
succeeded and found no error/fatal events in 02:08:43–02:09:59 UTC. The unavailable
attempt is not counted as a clean result. No deploy was repeated to address the
logging service's temporary read failure.
