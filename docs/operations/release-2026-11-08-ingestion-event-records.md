# BE-12 checked ingestion timeline records

## Finding and bounded plan

PgIngestionJobRepository.listEvents asserts EventRow types and returns details
JSON directly. The database enforces JSONB/not-null but permits an array or scalar
instead of the object expected by the product. A corrupt driver date also reaches
toISOString in the serializer. Decode this interpreted event row through the
existing stored-record helper, reusing the shared status/stage/details contract.
Keep real driver Dates and integer/nullable durations distinct from wire strings.

Preserve unknown nested detail values, zero versus absent timing, event order,
workspace/job predicates and the 100-event HTTP limit. Do not decode/rewrite file
payloads, change processing state, filter away legitimate event metadata or add
a new storage framework. Invalid pages must fail with fixed server diagnostics,
without stored details or a raw parser cause. This is a stored-read safeguard,
not a prompt-injection classifier or new authorization policy.

Unit cases cover metadata, zero/null durations, invalid JSON/date/enum/identity
shapes and absence. A disposable SQL fixture must use a failed/non-claimable job,
check another workspace returns no events, corrupt/restore only its own details,
and prove read reuse. No hosted migration, real document or provider is needed.
Existing processing/cancel/retry, real-SQL and independent-widget gates remain.

## Status

Implementation and local validation are complete; actual SQL/CI/publication
remain pending. Three new timeline-row cases plus existing process lifecycle and
narrow-capability cases passed (14 focused cases, zero skips). All seven local
harness checks pass; the optional performance gate remains unexecuted. Both
dependency graphs pass (450 structural modules/1,791 edges and 449 runtime
modules/1,299 edges).

The schema reuses shared stage/status/details contracts, retains real driver
Dates and integer/nullable stored durations, and preserves nested metadata and
ordering. It does not change worker admission, job payloads or job states. The
new disposable SQL test uses a failed, non-claimable job and corrupts/restores
only its own JSON event. Its real-SQL result is not claimed locally because the
Docker VM is full. No dependency, schema, key or hosted setting changes are
needed. Normal gates, image proof and the exact-source pilot remain required.
