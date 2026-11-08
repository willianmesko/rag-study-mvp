# BE-12 conversation records and recovery input

## Findings and planned scope

Persisted conversation views use a row assertion, read `input.question` and call
Date methods before validating their wire shape. Their final `ZodError` is
classified as a client error although the source is stored data. Pending
recovery returns persisted `input` as a trusted `QuestionInput`/comparison input
without a runtime check before dispatch. The database bounds JSON size/object
type, but does not enforce those complete product contracts.

Use the existing stored-record boundary and shared schemas for summary/turn
views. Check physical Dates/input envelopes before mapping, then decode the
existing wire contract without attaching received content or parser causes.
Keep public shapes, row ordering, pagination, ownership, source checks and
transaction fencing. A missing authorized turn remains absent; malformed
stored content becomes a fixed server error, not fabricated message content.

Make pending input explicitly `unknown` in its internal port. In the application
recovery loop, validate each mode/input using the existing question schemas
before dispatch. Fail an invalid queued item through the existing scoped
repository operation and emit a constant reason; continue other items. A bad
record must neither call a provider nor poison the whole pending batch. Keep
deadline/cancellation, claim/idempotency, current membership and quota checks.
Narrow delivery's injected records/runs to the capabilities it actually uses;
do not add a container, framework or external library.

## Acceptance and limits

Require safe unit failures for malformed IDs/dates/JSON/inputs; test read SQL
scope and cleanup. Recovery tests must prove per-item isolation, strict model
alias/mode/input checks, retained normal answer/comparison behavior, shutdown
and no raw question in reports. A disposable SQL case must exercise a corrupt
object that satisfies table constraints, safe views and its scoped terminal
transition without blocking a separate valid conversation. Application tests
prove provider dispatch behavior through the narrowed ports; the SQL case must
avoid running a global sweeper across concurrently executing fixture families.
Existing full database,
stream-replay, history/pagination and responsive UX gates remain required.

Corrupt message content stays in its authorized product record for diagnosis or
deletion; it is not copied into logs or silently replaced with a fictional
question. Reading that corrupt conversation may fail safely until repaired or
deleted. Provider budgets and authorization still belong to the existing
workflow, not to the model or a schema alone.

## Status

Implementation and local validation are complete; exact-source CI/publication
are pending. Summary/turn views use fixed stored-record errors and validate
physical Dates/input before mapping to shared wire contracts. Recovery input
and mode are explicitly unknown in the port. Each item is decoded before
dispatch; invalid items fail through the existing scoped operation with a
constant reason, and other items continue. Delivery uses seven record
capabilities and one run read instead of unrelated CRUD methods.

Fifteen focused cases passed with zero skips, including five recovery behaviors
and the existing/new stored-row cases. They cover invalid modes/inputs, bounded
history and aliases, safe diagnostics, checked views, existing-run deduplication,
comparison claim behavior, shutdown and state-write failure. The first local
assertion incorrectly expected question trimming; the shared contract preserves
that text, so the test now checks its exact preservation instead of changing
product behavior. All seven local harness checks and strict API/web types passed.
Both graphs are clean (450 structural modules / 1,780 edges and 449 runtime
modules / 1,287 edges). No visual baseline was changed.

A new required disposable SQL case covers malformed object input, fixed read
failure, a scoped terminal transition, an unaffected queued conversation and
explicit repair. Dispatch/cancellation and per-item recovery are tested through
the application ports; the SQL fixture deliberately avoids a global sweep that
could interfere with other test families. This case requires fresh CI proof;
the full local Docker VM was not used. No migration, dependency or actual
provider call is required. This is another bounded BE-12 increment, not complete
coverage of every persisted JSON family.
