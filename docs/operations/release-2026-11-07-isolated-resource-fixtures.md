# BE-12 remaining configuration fixture isolation

## Analysis and acceptance

Following the four-family migration, seven more HTTP fixture files still mutate
the imported settings object: originals/direct ingestion, URL import, evidence
previews, onboarding progress, usage analytics, notification inspection and
request-error handling. Each needs its own parsed synthetic settings and
explicit HTTP production policy. Arrays/booleans/numbers must enter through the
real environment parser as strings, preserving prerequisite validation.

Keep all current assertions and dependency mocks. Preserve original-file MIME,
tenant/role checks, preview redaction, generic onboarding, usage thresholds,
owner-only replay, parsing/multipart/rate limits and actual HTTP cancellation.
The direct-ingestion case must retain its own synthetic administrator key and
the configured demo tenant; no actual settings, notification or provider call
is needed. Demo fixtures must satisfy the existing administrator-key prerequisite.

Use the existing parser/factory rather than introducing another fixture library
or mutable global test wrapper. This extends the prior approach and affects
tests only. Success requires focused cases, strict types, the full local harness
and fresh CI; a read-only inventory must show the seven files no longer import
or mutate `config` or alter process environment. The scope was extended after
reviewing the remaining HTTP/database files below, retaining separate evidence.

## Additional reviewed scope

The next inventory pass found six remaining HTTP families: authentication/member
directory, chat runs, model comparison, workspace MCP, remote MCP and durable
workflow actions. Their settings are also fixture-local; extend this same
increment to those families rather than adding another shared wrapper. Retain
API-key/CORS separation for remote MCP, current membership/approval rules,
provider budgets, stream recovery and revocation/cancellation assertions.

Authentication has one deliberate 20 ms transport-timeout test. Production
environment parsing must retain its 1,000 ms minimum. Parse normal synthetic
settings, then pass the short test-only HTTP deadline explicitly to that one
instance; the gateway already supports that bounded deadline. Do not weaken
the environment schema or silently lengthen the timeout assertion. Two database
fixture files remain outside this HTTP migration.

## Final reviewed database scope

The two remaining mutations are also simple fixture setup: embedding cutover
changes the default model before creating bindings, and durable conversations
changes HTTP auth/stream settings inside a database subtest. Give both an
explicit synthetic configuration. Keep database URLs exclusively in the
existing test environment variables and retain disposable-host/name checks,
mandatory CI fixture guards, migrations and cleanup. No production database or
credentials are accessed. Actual SQL execution must be proven in fresh CI;
the full local Docker VM is not a reason to relabel skipped cases as passed.

The final import inventory also found one read-only legacy dependency in
`module-assembly.test.ts`. It does not mutate settings, but loading `config.ts`
still parses unrelated process/`.env` values. Give it a pure synthetic base as
well, retaining its assembly/no-eager-IO assertions. That makes 20 fixture files
in the complete migration: the original 19 mutable files plus this read-only
consumer.

## Status

All sixteen files in this follow-up are migrated. Together with the preceding
four-family increment, the original 19 mutable fixtures and the read-only
assembly consumer now use explicit synthetic settings. A final inventory of
all 96 backend test files found zero legacy `config.js` imports and zero writes
to that singleton.

The original seven files passed all 33 focused cases. The six additional HTTP
families passed 48 focused cases; all seven local harness checks then passed.
The three assembly/no-eager-IO cases passed after their migration, and strict
API/web types passed after all edits, including both database fixtures. The
architecture graph remains clean at 450 structural modules / 1,775 edges and
449 runtime modules / 1,281 edges. Fresh exact-source CI must still exercise
the actual database/cutover cases; these were not run on the full local Docker
VM. Publication requires the next complete release gates. No library, schema,
runtime behavior or production configuration is changed. BE-12 remains partial
for the stored-record/JSON inventory; removing fixture mutation does not close
that separate boundary work.
