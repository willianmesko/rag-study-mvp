# Checked records and measured capacity delivery

## Result and scope

Source `bbc1adad13e958ed952ba22d2dfb203a5bd692c7` is published on both services.
It includes the separately reviewed
[usage summary](release-2026-11-08-usage-summary-records.md),
[MCP source/status](release-2026-11-08-mcp-ingestion-records.md) and
[full ingestion-job](release-2026-11-08-ingestion-job-records.md) boundaries.
Existing Zod/contracts and fixed stored-data errors check interpreted numeric,
date and identity shapes without inventing zero measurements or leaking parser
values. Nullable fields, original Buffer identity, payload-free list SQL,
workspace predicates, authorization and transaction/lease policies are preserved.

The lab-only [native event-loop probe](capacity-event-loop-plan.md) adds
version-two per-phase measurements. It uses a read-only fixture mount and an
internal port only in the lab; no production endpoint/CMD or dependency was
added. Two [learning chapters](../learning-walkthrough.md) are prepared with
diagrams and source links. Teaching sessions/outcomes remain pending.

## Exact-source verification

All four [normal jobs](https://github.com/willianmesko/rag-study-mvp/actions/runs/42444829972)
passed: 410 UX cases/46 intentional profile skips, 95 actual PostgreSQL cases
with zero skips, the isolated embedding cutover, 78 architecture fixtures, both
dependency graphs, all seven harness checks, four native route-state, six
runtime-artifact and three payload-budget cases. The optional model-performance
gate remains unexecuted; the capacity report does not activate it.

The first combined SQL attempt at e3ed24a failed on two invalid fixture setup/
cleanup assumptions. The correction supplies synthetic original bytes and
deletes only owned jobs/documents before their tenant. All constraints remain;
the failed attempt is retained in the MCP record. Fresh 95-case SQL proof, not
the earlier failed run, gates this publication.

The [exact-source capacity lab](https://github.com/willianmesko/rag-study-mvp/actions/runs/42444829997)
also passed both short paths. The reviewed
[legacy report](../../reports/capacity/reviewed/pilot-bbc1ada.json) has 104
phase pairs; the [durable report](../../reports/capacity/reviewed/durable-pilot-bbc1ada.json)
has 99. Each completes six newly ingested source searches/answers and six unique
replayed uploads. The durable receipt has 105 completed chat rows, six completed
ingestion rows and 554 checkpoints. Native measurements exist in both phases
(586 and 1,184 samples for the durable cohort). All three processes exit zero
without OOM and owned cleanup reports zero failures.

The separate [30-minute result](capacity-sustained-result.md) is pinned to the
earlier 7c37d96 source: ten workspaces/50,000 chunks, 7,748 mixed phase pairs,
six completed ingestions and 47,892 checkpoints. Its unmeasured event-loop/pool/
billing values remain null. It is not silently relabelled as a final-source or
real-provider benchmark. BE-13 remains partial for its other acceptance criteria.

Actual API-image SQL proof applies 31 packaged migrations, then zero on repeat,
with 31 tracker versions. The final image has 492 runtime files/1,559,942 bytes,
14 explicit application roots and zero project test artifacts. The SQL catalog
has 31 files/52,893 bytes, SHA-256
`f3d3581a9a83a1568390cc0d249968dcec8016d09596a1004e043f6d711c253b`.
Both required actual OCR cases pass without skips. The minimal MCP image also
passes its existing bounded read-only/stdin protocol checks.

## Observed publication

Render captured the exact tested source for both deployments:

| Service | Deployment | Observed live, 2026-11-08 UTC |
| --- | --- | --- |
| API | dep-dbnvaa5g1s2s73dpks1g | 04:08:11.487804 |
| Frontend | dep-dbnvac8u01pc73drisfg | 04:06:59.341871 |

The Render build independently records two real OCR passes/zero skips at
04:06:48.562166 UTC, matching the clean runtime/catalog receipt above. No hosted
migration, key, permission, service plan or provider activation changed.

Public smoke checks at 04:09:54 UTC passed: frontend entry/lazy lifecycle/CSS
assets, source-identical icon bytes, API health, server-owned correlation ID,
401s on private MCP/alerts/conversations, S256/resource discovery, malformed
JSON/XML handling and denial of unauthenticated legacy JSON ingestion. Health
reports OCR, durable workflows and durable conversations available. The inspected
04:08:11–04:10:07 UTC error/fatal application-log window contains no entries;
that bounded observation is not a claim about all future failures.

Authorized flows are exercised in isolated CI fixtures, not by reading private
production documents or logging in as a real user. Real external-client OAuth
consent and optional exporter/provider activation retain their separate status.
No paid LLM, real email/webhook delivery or production document upload was used.

## Rollback and remaining work

The prior tested/live application source is 17d8aa7. No schema/data rewrite is
required to roll back these read-boundary changes. Keep the measured reports and
first failed fixture attempts as historical evidence. BE-12 retains other scoped
projections/guarantee reviews; BE-13 retains further measurement scenarios;
BE-08/FE-08, BE-09 and BE-14 retain their documented tooling/activation decisions.
The ticket status table is not closed merely because these increments shipped.
