# Architecture phase 2 and module delivery

## Candidate status

**Local verification complete; CI and deployment pending.** The prior live
application release remains `a59036044e19a4f35d38e4df8c8c18c7573de646`.
This record will be updated with the new source SHA, CI and exact deployment
receipts only after they are observed.

## Scope

- NestJS-inspired business-module organization using the existing Fastify/TS
  stack: Identity, Workspaces, Knowledge, Ingestion, Chat, AI, Evaluations, MCP,
  Usage and product Workflows. Technical facilities live in `platform`; `app`
  owns composition and HTTP lifecycle. No NestJS dependency or IoC framework.
- Explicit providers/controllers/ports, module Public APIs and a 270-line global
  composition/facade, reduced from the 766-line combined assembly checkpoint.
  Pool ownership, cache fingerprints, checkpoint keys, quota receipts, graph
  versions, budgets and lazy activation are retained.
- Bounded request identity and membership-ID-first directory access through
  stateless SDK clients; resource-specific SQL deadlines with cancellation,
  rollback and stricter-setting preservation.
- Conservative paid-reranker reservations and verified native-overrun handling.
  The real usage ledger is preserved, including unknown terminal outcomes.
- Single-flight bounded shutdown, legacy worker cancellation, independent
  resource cleanup and a recovery runbook. Existing CLI/MCP launch paths remain.
- Frontend application-owned routing/session composition, shared JSON response
  decoding and named FSD slice APIs. Successful malformed data never enters the
  resource cache; error diagnostics do not retain response values.
- Approved development-only `dependency-cruiser@18.7.2`, a small native syntax
  guard, Node 24 alignment and CI architecture checks. No existing dependency
  versions were upgraded; shared contracts build before checking package exports.
- Updated architecture/backlog documentation and an 18-chapter learning plan.
  The teaching sessions remain pending rather than being marked completed.

There is no database migration, secret/key rotation, embedding cutover, new
hosting service, paid benchmark, external mail or budget receiver activation.

## Local verification

| Check | Observed result |
| --- | --- |
| Strict type checks, API/web build and backend suite | Passed in the final local harness |
| Golden/security/replay/Promptfoo | Passed; bundled/local fixtures, no live Jina flag; Promptfoo telemetry/update checks disabled |
| Architecture graph | Zero structural/runtime violations; 416/415 modules, 1,640/1,219 edges |
| Architecture fixtures | 61 passed, zero failures/skips |
| PostgreSQL integration | 81 passed, zero failures/skips, disposable loopback database |
| Isolated embedding cutover | One passed, zero skips, separately named disposable database |
| Production image/native OCR | Build passed; both native/mixed-page and Portuguese scanned-PDF tests passed |
| Responsive UX | Initial complete Linux run: 241 passed, 44 deliberate profile skips, six failures in two outdated fixture/race cases across three profiles |
| UX correction | Only the two test fixtures/assertions changed; all 15 affected-suite checks passed on Linux and native Chrome, no application/schema/baseline weakening |
| Module composition | Fresh policy/receipt/budget/activation tests and complete assembly/close with zero eager DB/provider IO passed |

The harness passed seven checks. Its live latency/cost performance gate remains
conditional and unconfigured; this release does not claim measured production
capacity or real provider quality/cost comparisons.

The full UX CI run is still required after the fixture correction. The local
combined evidence must not be described as one already-green complete Linux run.

## Operational limits

- Read-only SQL is not a dedicated production MCP database role; BE-09 remains
  pending. Runtime role/connection-mode and capacity work remain separate.
- Session-level SQL defaults assume a direct/session connection. Transactional
  retrieval has local server-side caps; disconnecting from a transaction pooler
  does not guarantee instant backend cancellation.
- A provider charge already incurred is retained. A failed terminal transaction
  stays `effect_outcome_unknown`; it is not reported as a confirmed terminal commit.
- Shutdown is bounded best effort. A hard kill can interrupt cleanup; uncertain
  legacy/provider work needs review. See [shutdown](server-shutdown.md) and
  [integration recovery](integration-recovery.md).
- Supabase dependency findings and the smallest reviewed SDK fix remain
  documented but unpatched in [BE-14 evidence](dependency-hygiene-2026-11-07.md).
  The validated UUID gateway mitigation remains in place.
- Central trace/metric receivers, alert destinations, real client OAuth consent,
  paid Jina evaluation and live capacity evidence retain their own activation gates.

## Publication and rollback

Require all four GitHub CI jobs to pass for the exact source SHA, inspect Render
deploy history to avoid duplicate builds, and verify both resulting source SHAs,
health, protected routes and served frontend assets. The current public-Git-URL
Render services need a manual trigger after CI; their auto-deploy metadata is not
proof of a connected Git-provider trigger.

No schema rollback is needed. A rollback should revert the reviewed source
change through a new commit/CI run and deploy the compatible frontend/API pair.
Keep paid effect receipts and usage records; do not reset them to make retries
succeed. Key sets, provider configuration and external destinations are unchanged.
