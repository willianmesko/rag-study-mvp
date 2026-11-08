# Backend scalability review

## Decision

Keep Fastify and PostgreSQL/pgvector as the baseline. The TypeScript monorepo
already separates use cases from HTTP, database, storage, and model adapters.
That lets Lumora deploy ingestion separately while keeping one codebase and one
transactional data store. Features such as site localization and onboarding do
not require independent backend services. Chat streams, indexing, and evaluation
runs have different resource profiles and should have separate concurrency
budgets.

This is a source and configuration review. The repository defines a free-plan
API deployment and CI quality checks, but these do not establish production
capacity. At the time of that original review, no deployment, provider quota, or load test had been inspected or run.
[Service configuration](../render.yaml#L26) · [CI quality gate](../.github/workflows/quality-gates.yml)

## Workflow update, 2026-11-07

The original findings below are a dated review, not current implementation status.
The [LangGraph delivery](durable-workflows.md) now adds renewable fenced leases,
native encrypted checkpoints, graceful worker release, persistent resource
reservations, provider/OCR cancellation, and resumable authenticated chat.
The shared database and in-process worker remain intentional low-cost choices.
As of that dated update there was no throughput/load-test evidence; separate workers, shared burst
limits, connection budgeting, and tenant-skewed retrieval benchmarks remain open.

The later [backend architecture review](backend-architecture-review.md) evaluates
the expanded `e25572d` source and records current correctness/modularity findings
in the [technical backlog](technical-backlog.md). Use BE-13 for this benchmark's
execution status. The original table below is historical evidence, not a claim
that all of its earlier defects remain present.

The next architecture batch organizes the backend as feature modules, a shared
technical platform and explicit application composition. See the
[module guide](backend-modules.md). Workload-specific SQL limits and bounded
shutdown add reliability safeguards. The initially unexecuted mixed-load benchmark
now has the separately scoped evidence below. A directory refactor by itself
does not establish capacity or justify another hosting service.

## Measurement update, 2026-11-08

The [first sustained synthetic result](operations/capacity-sustained-result.md)
now records ten workspaces/50,000 chunks, ten clients and 30 mixed minutes at
pinned source 7c37d96: 7,748 mixed search/answer pairs, six completed uploads,
zero unexpected failures and successful owned cleanup. Mixed search p95 was
337.523 ms and validated completion p95 3,065.374 ms. Read the report before
interpreting those values as product capacity.

The heavy workspace completed fewer pairs and had higher search latency;
62/617 observations sampled a lock waiter. These are clues for per-stage SQL,
lock, pool and queue measurement, not proof that a particular service/index must
be replaced. Active-query count is not checkout wait, and queued-job age omits
already admitted durable work. Later native event-loop measurements have only
short-run evidence and do not backfill the long report. The later
[guarded-checkout histogram](operations/postgres-checkout-measurement.md) has
real queued-contention SQL proof and separate version-three short image-based
reports. It includes connection establishment/setup, aggregates guarded paths
across pools, and excludes direct queries. It does not establish pure queue wait,
production metric export, instrumented sustained capacity or replica sizing.

Keep the current demonstration topology. Real Auth/provider latency/billing,
large-file/reindex/evaluation bursts, slow readers, restarts, replica limits and
instrumented sustained/pool/lease waiting remain open. No production sizing or
real-provider SLO is certified. The original findings below remain dated
historical evidence; the technical backlog/receipts track corrected behavior.

## Original findings and priorities

| Priority | Finding | Next decision or change |
| --- | --- | --- |
| P0 | **Ingestion is coupled to API replicas.** Each process runs one ingestion job at a time in its HTTP process. PostgreSQL claims jobs atomically with `SKIP LOCKED`, but stale jobs are reclaimed after ten minutes without a heartbeat or ownership token. The old worker can still complete or fail a reclaimed job, and shutdown does not await the current job. [Server lifecycle](https://github.com/willianmesko/rag-study-mvp/blob/3f0a8ba720492343f60d0ae1a91f049c0b0cfde4/apps/api/src/server.ts#L5) · [Job claim and completion](https://github.com/willianmesko/rag-study-mvp/blob/3f0a8ba720492343f60d0ae1a91f049c0b0cfde4/apps/api/src/infrastructure/postgres/pg-ingestion-job-repository.ts#L16) | Add renewable leases, owner-checked state changes and idempotent writes. Test crash recovery, concurrent uploads for the same source, and shutdown before raising concurrency. Run the existing Postgres queue from a dedicated worker when the benchmark warrants it. |
| P0 | **SSE keeps work alive after disconnect.** The route stops writing based on the incoming request state but does not propagate cancellation or wait for write backpressure. The use case selects `answerStream` whenever available, including for JSON requests. That method bypasses the compiled graph and its step checks, and emits validated answer chunks only after generation has finished. [SSE route](https://github.com/willianmesko/rag-study-mvp/blob/3f0a8ba720492343f60d0ae1a91f049c0b0cfde4/apps/api/src/interfaces/http/app.ts#L396) · [Answer use case](https://github.com/willianmesko/rag-study-mvp/blob/3f0a8ba720492343f60d0ae1a91f049c0b0cfde4/apps/api/src/application/use-cases/answer-question.ts#L34) · [Workflow](https://github.com/willianmesko/rag-study-mvp/blob/3f0a8ba720492343f60d0ae1a91f049c0b0cfde4/apps/api/src/infrastructure/langgraph/langgraph-rag-workflow.ts#L48) | Share one workflow policy for both transports. Propagate cancellation and a deadline through the supported adapters, bound active streams and per-stream buffers, and track first event, first validated text, and completion separately. Add response-side close handling and respect Node's writable backpressure. [Node streams](https://nodejs.org/api/stream.html#writablewritechunk-encoding-callback) |
| P0 | **The public corpus is selected by configuration.** Anonymous search and Q&A use `DEFAULT_TENANT_ID` without checking `DEMO_MODE`. The migration seeds a demo tenant, but a deployment override can point to a different workspace. RLS is configured for member reads, while API authorization also depends on explicit repository predicates and the privileges of `DATABASE_URL`. [Public query routes](https://github.com/willianmesko/rag-study-mvp/blob/3f0a8ba720492343f60d0ae1a91f049c0b0cfde4/apps/api/src/interfaces/http/app.ts#L362) · [Demo seed](https://github.com/willianmesko/rag-study-mvp/blob/3f0a8ba720492343f60d0ae1a91f049c0b0cfde4/apps/api/db/migrations/007_tenant_isolation.sql#L10) · [RLS policies](https://github.com/willianmesko/rag-study-mvp/blob/3f0a8ba720492343f60d0ae1a91f049c0b0cfde4/apps/api/db/migrations/014_workspace_rls_policies.sql) | Before private production use, make public demo access explicit, verify the actual runtime DB role and grants, and test that a mismatched or revoked membership cannot read data through HTTP or the Data API. |
| P1 | **Postgres is shared by online traffic and background work.** The application pool is capped at ten connections per process. Every Q&A updates a shared daily tenant row and an actor row in one transaction. Reindexing issues an insert for each chunk within the document replacement transaction. [Pool](https://github.com/willianmesko/rag-study-mvp/blob/3f0a8ba720492343f60d0ae1a91f049c0b0cfde4/apps/api/src/infrastructure/postgres/pool.ts#L3) · [Quota transaction](https://github.com/willianmesko/rag-study-mvp/blob/3f0a8ba720492343f60d0ae1a91f049c0b0cfde4/apps/api/src/infrastructure/postgres/pg-quota-repository.ts#L9) · [Chunk replacement](https://github.com/willianmesko/rag-study-mvp/blob/3f0a8ba720492343f60d0ae1a91f049c0b0cfde4/apps/api/src/infrastructure/postgres/pg-document-repository.ts#L62) | Set a connection budget across API replicas, workers, and operational headroom. Instrument pool wait and quota lock time. Batch chunk inserts if replacement transactions dominate. Verify the actual Supabase endpoint and pooling mode before increasing replica counts. [Supabase connection options](https://supabase.com/docs/guides/database/connecting-to-postgres) |
| P1 | **Retrieval quality can vary by tenant size and language.** The vector query joins through documents to filter by tenant, against a global HNSW index. If the planner uses the approximate index, selective tenant filters can leave too few candidates. The keyword query and its generated index both use Portuguese full-text configuration. [Hybrid query](https://github.com/willianmesko/rag-study-mvp/blob/3f0a8ba720492343f60d0ae1a91f049c0b0cfde4/apps/api/src/infrastructure/postgres/pg-document-repository.ts#L91) · [HNSW index](https://github.com/willianmesko/rag-study-mvp/blob/3f0a8ba720492343f60d0ae1a91f049c0b0cfde4/apps/api/db/migrations/001_initial.sql#L31) · [Text index](https://github.com/willianmesko/rag-study-mvp/blob/3f0a8ba720492343f60d0ae1a91f049c0b0cfde4/apps/api/db/migrations/003_portuguese_text_search.sql#L7) | Compare plans and `recall@k` against exact tenant-scoped search on skewed data. Test English and Portuguese independently before changing keyword indexing. Consider iterative scans where the installed pgvector version supports them, then tenant-aware indexing or partitioning if the measured results justify it. [pgvector filtering and multitenancy](https://github.com/pgvector/pgvector#filtering) |
| P1 | **Authentication and throttling add shared-path costs.** Protected handlers call Supabase `getUser` before querying membership. Member listing fetches the first page of global Auth users before matching local memberships. Fastify burst limiting has no shared store configured, while daily Q&A quotas are shared in Postgres. [Auth and rate limiting](https://github.com/willianmesko/rag-study-mvp/blob/3f0a8ba720492343f60d0ae1a91f049c0b0cfde4/apps/api/src/interfaces/http/app.ts#L90) · [Member listing](https://github.com/willianmesko/rag-study-mvp/blob/3f0a8ba720492343f60d0ae1a91f049c0b0cfde4/apps/api/src/interfaces/http/app.ts#L172) | Measure auth separately. If signature verification can use cached signing keys, benchmark `getClaims` while retaining authoritative membership and suitable revocation checks. Page tenant members first and resolve only their identities. Before multi-replica rollout, make burst limits consistent at the gateway or through a shared store. [Supabase token verification](https://supabase.com/docs/reference/javascript/auth-getclaims) |
| P1 | **Cache and model budgets need a richer contract.** A cache hit still calls the embedding provider. Similarity lookup is scoped by tenant and expiry, so a hit can reuse the wrong language once multilingual answers are introduced. Estimated request cost omits retrieved context and embedding cost. [Answer use case](https://github.com/willianmesko/rag-study-mvp/blob/3f0a8ba720492343f60d0ae1a91f049c0b0cfde4/apps/api/src/application/use-cases/answer-question.ts#L17) · [Cache lookup](https://github.com/willianmesko/rag-study-mvp/blob/3f0a8ba720492343f60d0ae1a91f049c0b0cfde4/apps/api/src/infrastructure/postgres/pg-semantic-answer-cache.ts#L11) | Include response language and model or prompt version in the cache boundary. Measure actual provider usage for cache hits and misses, and account for context when enforcing spend limits. |

## Capacity test and cutover criteria

Use an isolated environment with synthetic Portuguese and English corpora and
test accounts. Start with a deterministic provider stub to find application and
database limits, then repeat a smaller run with real providers under a spend cap.
Record database size, API and worker instance sizes, configuration, and provider
limits with the results. The following numbers are initial test targets to tune
against expected demand, rather than measured capacity.

| Scenario | Starting workload |
| --- | --- |
| Baseline | 10 active workspaces, 50,000 chunks total, and up to 10 concurrent chat streams. |
| Growth | 50 active workspaces, 500,000 chunks, and up to 50 concurrent streams. |
| Stress | 200 active workspaces, two million chunks, and up to 200 concurrent streams. Stop when a guardrail or the environment budget is reached. |

For each tier, run steady mixed traffic for at least 30 minutes, then add bursts
of PDF/DOCX ingestion, reindexing, and evaluations while chat and search continue.
Record request rates and file size distribution with the run. Use many small
workspaces and one heavy workspace. Include cold and warm runs, cache hits and
misses, slow readers, client disconnects, provider throttling, worker termination,
and overlapping uploads. Compare API-only results to results under mixed load.

- **User experience.** Start with p95 search ≤ 1.5 s, first SSE event ≤ 500 ms,
  validated chat completion ≤ 12 s, and unexpected errors < 1% in the real-provider
  run. Report intended `429` responses separately. Split timings by authentication,
  database, provider, and response stage.
- **Ingestion and isolation.** Start with p95 queue wait ≤ 30 s at expected load,
  a draining backlog after a burst, and ≤ 20% p95 chat degradation for other
  workspaces while the heavy workspace indexes files. Require zero cross-workspace
  data exposure, lost jobs, or duplicate logical document writes. Compare retrieval
  recall for both languages against the exact baseline and record any regression.
- **Capacity and spend.** Track CPU, memory, event-loop delay, active streams,
  provider rate-limit errors, query plans, pool waits, lock waits, queue age and
  per-workload costs. Use sustained 80% utilization of the allotted DB connection
  budget as a trigger to inspect pooling and query behavior before adding replicas.

Keep the current topology while expected load meets the gates with headroom.
If ingestion causes queue lag or degrades interactive traffic in repeatable runs,
extract it into a separate process using the current Postgres queue and retest.
Evaluate a dedicated queue only if queue I/O, retry and scheduling requirements,
or tenant fairness remain limiting after that split. Evaluate a separate vector
store only if tuned pgvector cannot meet recall and latency together within the
cost budget. Revisit each decision with the same workload and report resource and
provider costs separately.
