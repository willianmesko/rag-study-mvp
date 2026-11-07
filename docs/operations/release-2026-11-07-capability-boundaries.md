# Replaceable backend capability boundaries

## Delivery status

BE-15 follows the published module-organization release `d045949`. Implementation
is complete and locally validated. The harness, architecture, actual PostgreSQL,
embedding cutover and native OCR checks passed. Exact-source CI/publication
evidence must be completed before calling this release live. The previous runtime
remains the production version until verified here.

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
- Exact-source CI, deployment IDs and production smoke checks: pending.

The local Docker data partition initially prevented the database suite with
SQLSTATE `53100`. Removing exactly five verified unused build-cache records from
this task reclaimed 1.067 GB; restarting only the task's existing disposable
PostgreSQL container allowed the suites to pass. No images, volumes, user
containers/data or unrelated cache were removed.

## Release and rollback

Require all four CI jobs for the exact source, then inspect both Render deploy
histories before triggering publication. Verify the resulting commit, API health,
protected routes, OAuth discovery and served frontend assets. No real grants,
provider calls, tenant documents or notifications are needed for smoke checks.

Previous verified runtime: `d0459492862a181d77860a1aa26a18e3385f1caa`.
There is no schema or checkpoint-format migration in this increment. A rollback
must still verify compatible configuration and the existing durable-state rules.
