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

The lab must create uniquely named, labelled resources, use no published
host ports, use synthetic credentials and allow only its reviewed image names. It
must never consume DATABASE_URL, cloud keys or application .env files from the
host. Cleanup is limited to that run's resources. The disposable database volume
is removed only after its owned containers stop. No Docker prune is permitted.
An interrupt triggers bounded cleanup. The local Docker VM is full, so actual
image/load proof must run on a fresh CI runner; local pure tests cannot substitute.

## Status

The pilot is implemented; eight native guard/provider cases pass with zero
skips. The corrected Linux pilot has passed; the first reviewed result is below. Scripts use native Node
modules and the existing pg/contracts packages. No application dependency or
production code changed. The normal quality gate runs the fixture tests; a
separate Capacity lab workflow builds the actual API image and retains the
measured JSON artifact. The migration-resource prerequisite is already published.

Run on a local Linux Docker host (or the GitHub runner), from the repository
root with Node 24 and dependencies installed. On Docker Desktop/macOS, run only
the portable fixture tests; the pilot does not bridge into the VM:

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


## First pilot attempt and network correction

The first [pilot run](https://github.com/willianmesko/rag-study-mvp/actions/runs/42434587485)
failed during start_lab before traffic, with no performance result. Its coarse
setup diagnostic did not isolate the substep. Review found that the runner
assumed host port mappings existed for an internal-only network. The revised
Linux runner uses only the owned container's private bridge address and rejects
public/metadata/loopback IPs, foreign networks and published host ports. Fixed
substage diagnostics and cleanup evidence now survive a setup failure.

Docker documents [host access to internal bridges](https://docs.docker.com/engine/network/port-publishing/#gateway-modes).
This is an orchestration correction, not evidence of a product capacity defect.
The corrected image/load run below passed; the initial failed attempt remains recorded.

## Reviewed pilot result (2026-11-08 UTC)

The [actual lab run](https://github.com/willianmesko/rag-study-mvp/actions/runs/42435067069)
passed at source `a85ecebc5eadfa606d44eb537e4905684af0f347`, between
01:39:10 and 01:40:05 UTC. The [complete reviewed report](../../reports/capacity/reviewed/pilot-a85eceb.json)
retains the image IDs, lock digest, resource caps, exact plans, measurements and
limitations. This result predates the additional chunk-ID ownership assertion;
the document-ID assertion was active on every search/citation result. The newer
chunk assertion must pass in a fresh pilot before publication of that increment.

| Measurement | API-only, 12 seconds | With ingestion, 24 seconds |
| --- | --- | --- |
| Completed search/chat pairs | 34 | 68 |
| Unexpected failures | 0 | 0 |
| Search p95 | 174.961 ms | 202.593 ms |
| First SSE event p95 | 90.965 ms | 8.997 ms |
| Validated completion p95 | 593.341 ms | 512.313 ms |
| Semantic cache hits | 0 | 23 |

Six uploads were replayed once each, produced six unique jobs and all completed.
Queue wait p95 was 3,043.120 ms. All nine synthetic exact-vector reference
comparisons had full overlap at five; the inspected vector candidate plans used
the document index and a sort, so this does not prove HNSW capacity/ANN recall.
All 13 periodic observations succeeded; none sampled a lock waiter. This cannot
rule out waits between samples. Pool checkout wait/event-loop delay/actual
provider billing remain unmeasured (null), not fictional zeros. The memory
figures are Docker container usage, not Node heap or RSS.

The API had a 512 MiB/0.5 CPU cap, PostgreSQL 2 GiB/2 CPUs and the deterministic
provider 256 MiB/1 CPU. All ran on one isolated runner, no host ports were
published, the Docker network was internal, and all three exited with code zero,
without OOM; owned containers/network/volume cleanup reported zero failures.

The phases warmed differently. Cache reuse and a small sample can explain a
lower later chat percentile; this does not establish that ingestion improved
latency or that fairness/SLO targets passed. The current durable replay reader
polls at 500 ms; observed completion cadence must not be attributed entirely to
model time. The report intentionally omits token events on cache hits from the
first-validated-text samples (45 samples for 68 mixed completions).

BE-13 remains partial. Next measurements: controlled cold/warm cohorts, at least
30 minutes/10 workspaces/50,000 chunks/10 streams, real pool/event-loop timing,
PDF/DOCX/OCR and durable-worker scenarios, slow readers/cancellation, crash
recovery and multi-replica limiter behavior. Keep the current topology until
those results support a change. Real-provider runs require a separate spend cap.

## Repeated pilot with checked replay and chunk ownership

The [second successful lab run](https://github.com/willianmesko/rag-study-mvp/actions/runs/42435430729)
at `fff266c525fc276d8486d3164549b1567f5461fc` passed between 01:44:16 and
01:45:12 UTC. The [reviewed report](../../reports/capacity/reviewed/pilot-fff266c.json)
includes the new persisted-event decoder and the chunk-ID ownership check active
on every search/context/citation result. It completed 35 API-only and 68 mixed
pairs, with zero failures. All six unique ingestions completed despite six
replays; queue p95 was 2,735.599 ms. The three owned processes exited normally,
no OOM was observed and cleanup reported zero failures.

Search p95 was 122.885/74.198 ms and completion p95 535.381/519.358 ms. Mixed
cache hits were 24 and the first-validated-text count 44. Differences from the
first successful pilot are diagnostic runner/cache samples, not a regression
baseline or a causal performance improvement. The same stated omissions and
sustained-load acceptance criteria still apply.

## In validation: newly ingested source ownership

The seed-only owner maps cannot establish ownership for IDs minted by a real
upload. A legitimate newly indexed passage could therefore fail the pilot merely
because it was absent from the seed. Resolve unknown IDs against this run's
owned fixture with a tenant-filtered, bounded read, then verify the chunk/document
pair as well as tenant ownership. Response tenant fields are never authoritative.

Nine native fixture cases pass; the seven-check local harness passes. After the
six jobs complete, the candidate also searches and answers against each new
source, outside measured traffic phases. This forces the real ownership lookup
instead of relying on whether a new passage happened to enter another query's
top five. An actual fresh image/load run remains pending. No production code or
SQL schema changes in this increment; sustained BE-13 criteria remain open.
