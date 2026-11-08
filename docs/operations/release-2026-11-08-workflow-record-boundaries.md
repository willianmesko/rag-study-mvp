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

Implementation and local validation are complete; actual SQL/image CI and
publication remain pending. Eight focused cases passed without skips, including
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
