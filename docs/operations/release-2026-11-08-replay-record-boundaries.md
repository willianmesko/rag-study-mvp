# BE-12 persisted chat replay boundaries

## Concrete finding and incremental plan

PgChatRunRepository declares event JSON as ChatRunEvent in a TypeScript query
generic, then returns it directly to the SSE replay writer. The database checks
that JSON is an object and at most one MiB, not that it matches a product event.
For example, a stored token with a numeric delta can reach delivery despite the
compile-time declaration. This is an unchecked persistence boundary, not evidence
that an unauthorized user can write to the table.

Decode the bounded physical replay page with existing Zod and the shared event
schema through decodeStoredRecord. Check real status/boolean/event sequence types
and paired nulls from the left join. Keep an empty/missing result absent; retain
one 64-event page, the 512-event ceiling, ordering, actor/workspace predicates,
deadlines, expiry and state transitions. Decode the small get-status row as well.
Do not introduce a second event DTO, new dependency or schema migration.

Unit cases must distinguish no run from no new events, preserve valid event
unions and cursor bindings, reject malformed stored tokens/citations/completions
without raw data in errors, and preserve expiry reconciliation. A disposable SQL
case must mutate only its own synthetic event, prove the sanitized failure and
restore it to prove the scoped connection remains usable. Existing chat/cancel/
reconnect, durable-conversation and workflow publication gates remain required.
This does not assert factual truth, repair corrupt events or newly authorize
access; the existing publication and membership policies retain those roles.

## Status

Implementation and local validation are complete; fresh CI/SQL and publication
are pending. Six new repository cases plus existing chat replay/cancellation and
workflow-route cases passed (13 focused cases, no skips). All seven local harness
checks passed; the optional performance gate was not run. Both architecture
graphs pass (450 structural modules/1,785 edges and 449 runtime modules/1,292
edges). A new real-SQL corrupt-event/repair/isolation case is implemented but
not claimed as executed locally because the Docker VM is full.

The schema is shared, the read page remains capped at 64 events and the run
ceiling at 512; a left-joined empty event page remains distinct from no run.
Existing SQL bindings/transitions are unchanged. The final source also strengthens
the isolated capacity pilot to verify chunk-ID ownership as well as document-ID
ownership; its fresh actual run remains required. No hosted database or provider
was called and no dependency, schema, public route or product contract changed.
