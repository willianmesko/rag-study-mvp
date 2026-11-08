# BE-13 sustained synthetic run

## Reviewed execution

The corrected short legacy and durable paths passed in
[Capacity lab 42441662257](https://github.com/willianmesko/rag-study-mvp/actions/runs/42441662257).
The durable fixture demonstrated 93 completed chat rows, six completed ingestion
rows and 502 checkpoints. Their source, complete reviewed reports, the first
failed instrumentation attempt and measurement limits are in the
[experiment plan](capacity-sustained-plan.md). All four [normal gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42441662380)
also passed before the reviewed launch commit.

The next marked main commit selects the fixed sustained profile: ten workspaces,
50,000 deterministic 1024-dimensional chunks, 80% in one workspace, ten bounded
clients, a 60-second control phase and 1,800 seconds of mixed traffic. Six uploads
are replayed and must produce six completed jobs. Every result must preserve
workspace, document and chunk ownership; post-ingestion sources are checked too.
Durable chat/ingestion completion and encrypted checkpoint existence are required.

Run only the existing standard ubuntu-latest runner, with the actual API image,
fresh owned PostgreSQL/pgvector and deterministic provider fixture on an internal
Docker network. API: 512 MiB/0.5 CPU; database: 2 GiB/2 CPU; provider: 256 MiB/1 CPU.
Keep the ephemeral key, fixed lab quotas/provider deadline, 60-second cache TTL,
owned cache reset between phases, explicit workload version and measured cache
hits. No application environment file, private document, hosted database or
paid provider is read. Publish no host ports or container images.

The process has a 45-minute total deadline, the CI job a 48-minute cap. A failure
stops traffic and must retain only safe categories/counts, never raw error bodies.
Cleanup is restricted to that run's labelled containers/network/volume, after
owned processes stop. Capture exit codes/OOM state and cleanup results. Retain
small JSON artifacts for 30 days; storage allowances are separate from runner
compute. No broad Docker cleanup or production deployment is part of this run.

The marker [capacity-sustained] is an explicit reviewed selection for this
documented experiment. It is not a default 30-minute test on every push. The
report's exact GITHUB_SHA, lock digest, corpus version and image IDs identify
the tested candidate. A measured report is still required; the launch document
does not certify the result.

## Interpretation and remaining work

This measures one isolated process with simulated identity/provider timings.
Do not label synthetic token usage/cost as billing, vector overlap as semantic
faithfulness, or Docker resource use as Node heap/RSS. It does not measure Render
capacity, real external provider latency, large PDF/DOCX/OCR bursts, slow readers,
worker restart/recovery, pool checkout wait, event-loop delay, or multiple replicas.
Missing measurements remain null. The model-performance release gate has its own
baseline and is not activated by this infrastructure report.

BE-13 stays partial even on success. Record observed bottlenecks before proposing
a queue, dedicated worker, shared limiter, topology or index change. No hosting,
database policy, paid service or production capacity increase is authorized by
the report itself. A failed experiment remains evidence, not a passing baseline.

## Status

Selected by this reviewed launch commit. No sustained result is claimed yet.
Record the actual source, CI URL and reviewed artifact when the run completes.
The candidate also contains the separately documented usage-summary decoder;
its fresh SQL and normal gates remain mandatory before application publication.

The active run is [Capacity lab 42442232215](https://github.com/willianmesko/rag-study-mvp/actions/runs/42442232215)
at source `7c37d96e2fbf1da961bae1816b7534799517a9bb`. All four
[normal gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42442232284)
passed separately. Subsequent source/MCP/job/probe changes require their own
fresh normal/image-based pilot evidence before a combined application release.
This run remains pinned to its original source and has no event-loop probe.
