# BE-13 bounded sustained capacity experiment

## Evidence and next decision

The reviewed short pilots prove the harness, scoped sources, ingestion replay
and cleanup, but not sustained scale. The next bounded experiment uses ten
workspaces/50,000 synthetic chunks, ten clients and 30 minutes of mixed traffic.
One workspace owns 80% of the corpus. Keep the existing resource caps and
deterministic providers. Use a separate short durable pilot before the long run,
so expensive setup is not the first test of that execution path.

The old workspace * 10,000 chunk-ID stride collides when a workspace contains
40,000 chunks. Increase the stride within the existing synthetic UUID format,
validate profiles and record corpus version two; never compare it as identical
to version-one baselines. Vectors still do not measure semantic or multilingual
quality. Keep exact-vector reference comparisons and document/chunk ownership.

Use encrypted durable workflows with a new synthetic per-run key, local fixture
identity and fixed provider names. The sustained cohort uses the minimum allowed
60-second semantic-cache TTL, a workspace-sized key sequence and clears only its
owned fixture cache between phases. Record actual cache hits, workload/deadline
settings and omissions instead of assuming the cohort stayed cold.

The driver has fixed pilot/durable-pilot/sustained profiles, no arbitrary scales,
timeouts or provider URLs. The long experiment has a 45-minute total deadline
(including seed/setup), a 48-minute CI cap, bounded observations and stops traffic
on failures. Retain the current guarded cleanup and no external provider egress.
Normal pushes run short pilots. The sustained profile requires explicit workflow
selection or the reviewed [capacity-sustained] main-commit marker; no production
deployment or database is used for the experiment.

This public repository uses the existing standard ubuntu-latest runner.
[GitHub documents free standard-runner compute for public repositories](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
Artifact/cache storage has separate allowances; retain small bounded JSON
measurements, not container images or corpus dumps. No paid LLM or hosting
service is added. The measured run remains required before drawing conclusions.

Even a passed sustained run will not complete BE-13: pool/event-loop timing,
large PDF/DOCX/OCR bursts, restart/slow-reader cases and multi-replica limits
remain separate. Do not change the production topology based on a short pilot
or call simulated-provider timing real-model performance.

## Status

The three fixed profiles and corpus version two are implemented locally. All
11 portable fixture/profile cases pass, including uniqueness across the 50,000
chunk IDs. A durable profile must also show completed chat/ingestion rows and
persisted checkpoints in its owned database; enabling a flag is not execution
proof. Short image-based proof, normal CI and the sustained run remain pending.
The workflow runs both short profiles on a normal selected push. No sustained
commit marker has been sent yet.
