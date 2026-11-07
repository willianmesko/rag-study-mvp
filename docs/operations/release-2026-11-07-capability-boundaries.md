# Replaceable backend capability boundaries

## Delivery status

**Frontend and API are live** at exact source
`cbd0f677baff2b415b16a785ea67bcbf48c99cc2`. BE-15 follows the module-organization
release `d045949`. All four [CI jobs](https://github.com/willianmesko/rag-study-mvp/actions/runs/42401306893)
passed before either deployment was triggered.

| Service | Deployment | Observed live at UTC |
| --- | --- | --- |
| API | `dep-dbnn4o49v7es73d7puj0` | 2026-11-07 18:50:08 |
| Frontend | `dep-dbnn4pe417fc73e7ijbg` | 2026-11-07 18:48:54 |

Both Render records match the source SHA above. A later documentation-only
receipt does not change the deployed runtime SHA. No frontend behavior change is
part of this backend refactor; its responsive regression suite still ran.

## Scope

- Business factories assemble use cases and policy through application ports and
  plain feature options. PostgreSQL clients, provider SDKs, LangGraph/LangSmith
  constructors and vendor environment keys belong to outer composition.
- Existing adapters remain grouped with the feature that owns them. Explicit
  `app/composition` bindings select providers, storage, identity, workflow engines,
  tracing, ingestion and evaluation implementations. No DI framework is added.
- A backend-owned, read-only capability registry selects answer, embedding,
  optional judge and reranker factories. Unsupported capabilities fail closed;
  public model catalogs are not expanded by an internal registration.
- Pure redaction and usage decorators move into application services with the
  same behavior. Compatibility reexports preserve existing operator/test imports
  and the `DeliveryCommandError` constructor identity.
- Workspace, knowledge, usage and MCP factories receive repository/service ports.
  PostgreSQL action completion receives a same-client evaluation writer selected
  in composition, preserving atomic report insertion, lease fencing and rollback.
- Workflow ports expose product inputs, results, execution versions and plain
  options, rather than graph SDK state or saver types. Existing versions, cache
  tuples, fingerprints, admission plans, quota receipts and budgets are retained.
- Architecture checks reject concrete infrastructure, vendor SDK and environment
  imports from application/domain code and module factories, including type-only
  imports. Public module exports cannot leak infrastructure implementations.

No dependencies, public HTTP schemas, database migrations, secrets, model
activation, paid benchmark or provider configuration are changed.

## Compatibility and replacement evidence

Typed alternative adapters cover new internal provider registration without a
business-policy branch, in-memory evaluation persistence, an alternative workflow
factory/executor, tracing decoration and an independent workflow engine. Tests
also retain redaction, usage provenance, budgets, cancellation, workspace scope,
membership revocation, index versions and exact signature/admission hashes.

Current supported provider identities and embedding SQL constraints remain
explicit. A new public model still needs reviewed backend catalog/contract
activation. Changing embeddings requires versioned reindexing, compatible
dimensions and cache invalidation. A new database/runtime must meet transactional
and checkpoint migration requirements; an interface alone provides no data or
state migration.

## Validation record

- Integrated API typecheck passed.
- Seven-check local harness passed: typecheck, unit tests, production build,
  prompt-injection suite, golden set, replay regression and local Promptfoo.
  Golden set: 4/4, hit rate 100%, MRR 1; injection suite: 6 cases, no failures.
  Promptfoo telemetry/update checks disabled, no API keys or project `.env` files.
  The optional live performance gate remains unconfigured.
- Architecture graph: zero violations, 436 structural modules/1,712 edges and
  435 runtime modules/1,231 edges. All 78 fixtures passed with zero skips (61
  retained plus 17 technology-boundary cases).
- Integrated HTTP, graph and assembly suite: 104 passed with zero skips.
  Targeted provider/Jina checks: 14 passed. Persistence/access port-focused suite:
  32 passed. These overlap with normal unit coverage and are not additive totals.
- Required real PostgreSQL profile: 83 passed with zero failures/skips, including
  both new action-completion rollback cases. Isolated embedding cutover: one
  passed, zero skips, in a separately named disposable database.
- Clean API rebuild passed. Both native OCR tests passed, zero skips, with the
  new compiled API mounted read-only into the previously verified native runtime
  image. Dependencies/native binaries are unchanged; this is not a claim of a
  second complete local image build. The deployment Dockerfile also runs OCR
  smoke while building the fresh production image.
- Exact-source CI passed all four jobs. PostgreSQL: 83 passed, zero skips;
  isolated cutover: one passed, zero skips; architecture: 78 passed, zero skips
  and zero graph violations; all seven harness checks passed. Responsive UX:
  247 passed with 44 intentional profile skips in 4.5 minutes.

The local Docker data partition initially prevented the database suite with
SQLSTATE `53100`. Removing exactly five verified unused build-cache records from
this task reclaimed 1.067 GB; restarting only the task's existing disposable
PostgreSQL container allowed the suites to pass. No images, volumes, user
containers/data or unrelated cache were removed.

## Production verification

At 18:50:27 UTC, public checks confirmed frontend HTTP 200 and the expected
`/assets/index-D0WsjGJB.js` asset, successful-response decoding/recovery markers
and the source-matching 256×256 Lumora PNG icon. API health returned 200 with OCR,
durable workflows and durable conversations active. Server-generated request IDs
override client-selected values.

Unauthenticated MCP, budget-alert and conversation routes returned 401. OAuth
resource discovery retained the exact resource, Lumora name and S256 support;
malformed JSON/unsupported token MIME returned sanitized 400/415, and missing
resource/PKCE parameters were denied. No provider call, document access, real
OAuth grant, third-party consent or notification was created.

The API error/fatal log query from 18:50:08 to 18:50:43 UTC returned no records.
This is the inspected window. Real third-party OAuth consent, central telemetry
receiver activation, paid provider comparisons and mixed-workload capacity
remain separate backlog/activation work.

## Release and rollback

Require all four CI jobs for the exact source, then inspect both Render deploy
histories before triggering publication. Verify the resulting commit, API health,
protected routes, OAuth discovery and served frontend assets. No real grants,
provider calls, tenant documents or notifications are needed for smoke checks.

Previous verified runtime: `d0459492862a181d77860a1aa26a18e3385f1caa`.
There is no schema or checkpoint-format migration in this increment. A rollback
must still verify compatible configuration and the existing durable-state rules.
