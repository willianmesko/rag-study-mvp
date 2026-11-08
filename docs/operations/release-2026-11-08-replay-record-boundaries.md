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

Implementation, validation and publication are complete at
`fff266c525fc276d8486d3164549b1567f5461fc`. Six new repository cases plus existing chat replay/cancellation and
workflow-route cases passed (13 focused cases, no skips). All seven local harness
checks passed; the optional performance gate was not run. Both architecture
graphs pass (450 structural modules/1,785 edges and 449 runtime modules/1,292
edges). A new real-SQL corrupt-event/repair/isolation case is implemented but
not claimed as executed locally because the Docker VM is full.

The schema is shared, the read page remains capped at 64 events and the run
ceiling at 512; a left-joined empty event page remains distinct from no run.
Existing SQL bindings/transitions are unchanged. The final source also strengthens
the isolated capacity pilot to verify chunk-ID ownership as well as document-ID
ownership; its fresh actual run passed at this exact source, as recorded below. No hosted database or provider
was called and no dependency, schema, public route or product contract changed.

## Fresh independent checks

The actual isolated capacity run at this source passed, including 103 scoped
search/chat pairs, all six deduplicated ingestions and clean exits. The fresh
PostgreSQL job passed 89 cases with zero skips, including the new malformed
stored-event/isolation/repair case. Its actual read-only API image applied all
31 migrations, repeated zero and retained the matching SQL digest. Both native
OCR cases passed; the final application tree reported 490 files/1,549,090 bytes,
14 entries and zero project test artifacts. The remaining quality gates and
both observed publication records were subsequently verified below.

## Published evidence

All four [quality gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42435430674)
passed, including 410 UX cases/46 deliberate skips, 89 PostgreSQL cases without
skips, the isolated cutover, 78 architecture fixtures, seven harness checks,
four native route cases, six artifact cases, eight capacity-fixture cases and
three payload cases. The separate actual [capacity pilot](https://github.com/willianmesko/rag-study-mvp/actions/runs/42435430729)
passed at the same source. Earlier candidates were not independently deployed.

Both services were observed LIVE at the exact source on 2026-11-08:

- API `dep-dbntasijnfac73db0ud0`: 01:52:35.594342 UTC.
- Web `dep-dbntatlg1s2s73dkm4ig`: 01:51:28.672008 UTC.

The Render build at 01:51:17 UTC independently passed both native OCR cases and
reported the same catalog/clean tree as CI. The public 01:53:58 UTC check verified
entry/lazy/CSS assets, original icon bytes, health/readiness, request correlation,
protected routes, discovery and malformed-request handling. An empty unauthenticated
legacy document request returned 401, without a valid document or provider call.
The API error/fatal window 01:52:35–01:55:40 UTC was empty. This verified the hosted
demo's response; BE-16 separately addresses the private configuration gap.
