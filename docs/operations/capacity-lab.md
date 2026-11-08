# Isolated capacity pilot (BE-13)

## Finding and bounded plan

The scale review defines acceptance targets, but unit, UX and SQL correctness
checks do not measure a real HTTP process under mixed search/chat/ingestion.
There is no recorded sustained-load result. Native PostgreSQL and HTTP tools,
the existing pg/contracts packages and Docker are sufficient for a first pilot;
adding a load framework, queue or paid service before measurement is unjustified.

Run the actual API image with a fresh pgvector database and deterministic local
identity/embedding/chat fixtures on an internal Docker network. Seed three
workspaces with a skewed 1,000-chunk corpus. Compare a short search/chat phase
with one that also queues uploads in the largest workspace. Check source scope,
explicit membership denial, upload deduplication and terminal ingestion state.
Capture timings, PostgreSQL waits/locks/queue age and container resource samples.
Retain a versioned JSON report without questions, source contents or credentials.

This is a harness pilot, not the 30-minute/50,000-chunk baseline, not a semantic
quality benchmark and not a Render sizing result. Report unmeasured pool wait,
event-loop delay, real-provider time/cost, slow-reader, crash/restart and
multi-replica behavior explicitly. Keep BE-13 partial until its actual criteria
are measured. Do not change database indexes, workers, limits or hosting based
on a short pilot. No application library is installed or replaced.

The lab must create uniquely named, labelled resources, expose only loopback
ports, use synthetic credentials and allow only its reviewed image names. It
must never consume DATABASE_URL, cloud keys or application .env files from the
host. Cleanup is limited to that run's resources. The disposable database volume
is removed only after its owned containers stop. No Docker prune is permitted.
An interrupt triggers bounded cleanup. The local Docker VM is full, so actual
image/load proof must run on a fresh CI runner; local pure tests cannot substitute.

## Status

The pilot is implemented; seven native guard/provider cases pass with zero
skips. Actual isolated image/load execution is pending. Scripts use native Node
modules and the existing pg/contracts packages. No application dependency or
production code changed. The normal quality gate runs the fixture tests; a
separate Capacity lab workflow builds the actual API image and retains the
measured JSON artifact. The migration-resource prerequisite is already published.

Run from the repository root with Node 24, dependencies installed and Docker:

```sh
npm run build:contracts
npm run test:capacity
docker build --tag lumora-api:capacity-ci --file apps/api/Dockerfile .
npm run bench:capacity -- --image lumora-api:capacity-ci --report-id pilot
```

No host application environment file is needed or read. The synthetic Docker
configuration is explicit; real cloud credentials are never forwarded. Reports
are written under reports/capacity and ignored as per-run output. Reviewed results
belong in a separate evidence document. A global four-minute deadline and per-read
15-second limits bound the pilot; stopping it cancels traffic and cleans only its
owned labelled resources. The fixture is not an authentication service for use
outside this isolated lab.

The report records separate 12-second API-only and 24-second mixed phases,
per-workspace nearest-rank p50/p95/max, cache hits, first event, first validated
text, completion, queue waits, safe vector-candidate query plans, exact-vector
reference overlap in PT/EN, resource caps/actual image IDs, periodic connection/
lock/queue/container observations and final cleanup/exit evidence. Synthetic
recall is hybrid result overlap against exact vector results, not faithfulness,
semantic recall or an isolated ANN benchmark. Missing measurements are null with
explicit limitations; configured estimates are never called actual billing.

