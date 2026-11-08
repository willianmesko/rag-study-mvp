# BE-12 workspace configuration record boundaries

## Findings and implementation plan

`PgWorkspaceModelPolicyRepository` parses persisted JSON using the shared Zod
contract directly. Invalid stored policy raises `ZodError`, which the HTTP
boundary classifies as invalid client input even on a valid GET. The table
checks JSON object type/size, not the full routing policy; malformed historical
or operational writes can therefore reach this path. Missing INSERT rows use
the same misleading parser error.

`PgWorkspaceOnboardingRepository` trusts a physical-row assertion and indexes
the guide-step tuple without runtime decoding. A malformed driver row or absent
RETURNING row can produce an undefined step or incidental TypeError. SQL already
constrains normal values; retain those constraints and monotonic upsert behavior.

Use the existing `decodeStoredRecord` fixed-error boundary in both adapters.
Policies keep the existing shared schema. Onboarding first validates physical
row types/step range, transforms its row to the existing product shape and pipes
through the shared progress contract. Preserve `null` for a genuinely absent
GET; reject a missing INSERT result. Do not expose stored values, parser issues
or causes, add another validation library, relax database constraints or add a
generic repository abstraction.

Acceptance requires policy/schema failures to be server-side stored-record
failures rather than client validation failures; keep strict allowlist/routing
invariants. Preserve generic and legacy guide goals, empty initial progress,
monotonic step/completion and workspace/user predicates. Unit cases must reject
invalid/missing rows with fixed safe diagnostics. Disposable SQL cases must
verify driver JSON/SMALLINT decoding, routing corruption, identity scope and
monotonic writes without altering tables. Full exact-source CI remains required.

## Status

Validated and published at `4f778664d71bc03d215dd6e7f5bdb537cd5102cd`.
Policies decode their physical row using the existing shared policy
contract; missing rows and invalid routing raise `StoredRecordError`, not
`ZodError`. Onboarding decodes physical types and a bounded step index before
transforming/piping through the shared progress schema. Genuinely absent GETs
remain `null`, while missing INSERT results fail safely. The SQL upserts and
authorization predicates are unchanged.

Thirty-two focused cases passed with zero skips, including four new stored-row
cases and the existing onboarding/model suites. All seven local harness checks
passed. Both dependency graphs are clean (450 structural modules / 1,779 edges;
449 runtime modules / 1,285 edges). No baseline or assertion was weakened.

Two new disposable PostgreSQL cases are registered in the existing required
database job. They cover JSON routing corruption/repair, real SMALLINT progress,
monotonic writes and user/workspace isolation. They were not run against
the full local Docker VM; fresh CI supplies the actual SQL proof below. This
covers two more bounded families and does not complete the remaining
repository/JSON inventory. No migration, dependency, credential, real user
content or paid provider call is required.

## Publication

All four [exact-source CI jobs](https://github.com/willianmesko/rag-study-mvp/actions/runs/42428605858)
passed: 87 real PostgreSQL cases / zero skips, the isolated cutover, 410 UX cases
/ 46 deliberate skips, 78 architecture fixtures, seven harness checks, four
native route-state, three artifact and three payload checks. The restricted MCP
image again passed its five-tool/network-disabled/write-rejection check.
The actual SQL job, not a local skip, proves the two added row families and the
remaining configuration-fixture migration.

| Service | Deployment | Observed live on 2026-11-08 UTC |
| --- | --- | --- |
| API | `dep-dbns1ijrjlhs739n54h0` | 00:23:47.739433 |
| Web | `dep-dbns1jnf3r2c739g5rfg` | 00:23:27.607817 |

The Render build at 00:23:08 UTC passed two actual native OCR cases / zero skips,
with 490 clean runtime files, 1,539,761 bytes, 14 entries and no project test
artifacts. Public checks at 00:24:25 UTC confirmed served assets/icon, semantic
styles, health capabilities, correlation IDs, private-route protection and
bounded OAuth handling. API error/fatal logs were empty from 00:23:47 to
00:24:46 UTC. Real-provider questions and third-party consent were not exercised.
