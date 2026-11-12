# NestJS/Fastify migration and Prisma pilot

Status: native-controller/guard and runtime-module cutover **published** in the
API at `448c91e`, after four passing gates for identical-tree source `c1a0c19`.
See the [production receipt](../operations/release-2026-11-12-nest-native-cutover.md).

## Decision and scope

The owner requested standard Nest modules, Nest dependency injection, preserved
HTTP contracts, and a bounded Prisma pilot. The starting point is `c6a90e9`.
Existing work in the original checkout was preserved in place; implementation
uses the `nest-prisma-pilot` worktree.

NestJS 12.5.0 runs on its Fastify adapter and Fastify 5.12.8. Prisma Client,
Prisma CLI and the PostgreSQL adapter are pinned to the same stable 7.10.1 release;
the registry's Prisma 8 release candidate was deliberately not selected.

This increment changes the actual API entry point, not just directory names:

- `server.ts` boots `createNestHttpServer`.
- `NestApplicationModule` registers configuration, the application runtime and
  HTTP dependencies with Nest providers and explicit injection tokens.
- `PilotPersistenceModule` binds the workspace model-policy repository port to
  `PrismaWorkspaceModelPolicyRepository` through a factory provider.
- `HealthController` is a native Nest controller and preserves `/health`.
- All HTTP business features now use native decorated controllers in feature HTTP
  modules. Explicit guards own role/session/consent policies; specialized handlers
  preserve conditional demo/legacy validation ordering.
- Runtime modules inject ten capability groups with Nest factory providers. The
  API does not call the transitional `createApplication`; CLIs reuse the same
  small outer composition factories.
- Transport hooks retain the original safe errors, multipart/rate-limit plugins,
  request IDs, cancellation and shutdown. Native route metadata carries limits.
  Automatic HEAD is disabled; explicit HEAD methods preserve the old contract.

```mermaid
flowchart TD
  Entry[API entry point] --> Nest[Nest application and DI]
  Nest --> HTTP[Feature HTTP modules]
  HTTP --> Guards[Role / MCP / consent guards]
  Guards --> Controllers[Native controllers and transport handlers]
  Nest --> Runtime[Ten runtime modules]
  Runtime --> Factories[Small composition factories]
  Controllers --> Ports[Business use cases / ports]
  Factories --> Ports
  Runtime --> PrismaModule[PilotPersistenceModule]
  PrismaModule --> Prisma[Prisma model-policy adapter]
  Prisma --> Existing[(Existing workspace_chat_model_policies)]
  Factories --> SQL[Existing SQL repositories and pgvector]
```

## Remaining bounded scope

The standalone CLI and MCP entry points reuse the composition factories without
booting an HTTP server. Compatibility registration helpers remain available to
focused transport fixtures but are not used by the production Nest dispatch.
Business ports remain independent of Nest and Prisma. HTTP request/response
validation still uses the established Zod schemas, rather than replacing all
contracts with new DTO/decorator libraries in this migration.

The legacy SQL model-policy adapter remains for standalone entry points and
rollback. The production API receives the Prisma implementation through Nest DI.
A second Prisma repository requires a separate benchmark and acceptance decision;
specialized SQL and hosted schema changes are outside this cutover.

## Prisma scope and database safety

The partial Prisma schema maps only `workspace_chat_model_policies`. It does not
own the database schema. Existing `db/migrations` remain authoritative, including
RLS, constraints, grants, indexes, vector types and tenant foreign keys. No new
DDL or hosted database mutation is required. Do not use `prisma db push`,
`migrate reset` or automatic Prisma migrations with this partial mapping.

The adapter uses typed `findUnique` and atomic `upsert`, scopes every operation by
`tenantId`, validates input and stored JSON with the existing Zod contract, and
leaves owner authorization and server-controlled model allowlists intact.
Switching ORM does not itself implement authorization or bypass existing RLS.

Prisma uses `@prisma/adapter-pg`, so `pg` remains a driver dependency and remains
necessary for the rest of this SQL-heavy system. The pilot adds at most two
connections per API instance. It reuses our existing pool policy for connection
and SQL deadlines and safe error reporting; it creates no new per-request pool.
Account for these two connections when sizing replicas. Nest disconnects Prisma
and closes its pool. The existing coordinator closes HTTP, drains background
work, then closes Nest-managed application/database resources and telemetry.

Generation runs before the API build, typecheck, tests and development startup.
Generation does not connect to the database. Runtime images copy the generated
client from the build stage; the Prisma CLI remains a development dependency.

## Compatibility and verification

Nest's default exception handling would change existing Zod and provider-budget
errors. A Nest exception filter reuses the existing safe HTTP error policy and unwraps
Fastify's mapped causes. OAuth routes retain their protocol-specific error shape. Error contents
remain sanitized. Existing critical behavior suites now exercise the real Nest
bootstrap, rather than validating only the old factory.

Run from the repository root after `npm ci`:

```sh
npm run build:api
npm run typecheck
npm --workspace @rag-study/api run test:nest
npm test
npm run check:architecture
npm run test:architecture
npm run eval:harness
```

The Prisma integration command requires a disposable local `prisma_pilot_*`
database with the existing migrations and the local auth fixture applied:

```sh
PRISMA_PILOT_DATABASE_URL=postgresql://rag:rag@127.0.0.1:5438/prisma_pilot_local \
  npm --workspace @rag-study/api run test:prisma
```

The dedicated CI step creates `prisma_pilot_ci`, applies the same SQL migrations,
and runs the integration command without skips. The test verifies Nest's actual
repository binding, existing SQL interoperability in both directions, per-tenant
isolation, owner versus viewer and non-member access, model allowlisting, checked
stored records, preserved RLS and pool disposal. Existing SQL conversation tests
also use the Nest HTTP bootstrap.

Local validation: 452 backend cases pass with one pre-existing conditional skip;
80 architecture fixtures and 100 real PostgreSQL cases pass without skips; the Prisma integration passes
without skips; strict API/web types, both architecture graphs and all seven
evaluation harness checks pass. The final API image includes the generated
Prisma client and passes both native OCR cases with zero skips. A container
smoke verifies health 200, unauthenticated model-policy access 401 with synthetic
auth configuration, and clean SIGTERM exit 0. Without auth configuration the
same private route returns the existing fail-closed 503 response. No AI provider
was called. SQL migration hashes remain unchanged.

The production dependency audit retains two pre-existing low-severity Supabase
findings, tracked by the existing dependency-hygiene backlog; no automatic
SDK-wide upgrade was included in this migration.

All four remote CI quality gates passed for implementation commit `3168f54`:
[quality gates run 43238220630](https://github.com/willianmesko/rag-study-mvp/actions/runs/43238220630).
This includes the required Prisma integration and the unchanged UI suite.
The subsequent documentation-only receipt commit does not change runtime code.

Initial-pilot evidence above is retained for history. The native cutover and
production smoke are recorded below; no hosted load-capacity claim follows.

## Follow-up scope

Review another ordinary CRUD repository only after benchmarking its transactions,
RLS and concurrency invariants. Retain specialized retrieval, leases, outbox and
vector SQL unless an equivalent is measured and verified. Hosted streaming,
usage/tracing and capacity must be checked separately from local fixture evidence.

## Native cutover verification (2026-11-12)

- Native/compatibility route inventories match: 55 method/path entries without
  optional features and 98 with conversations, MCP/OAuth and approved actions.
  This comparison includes HEAD, configured body limits and per-route rate limits.
  It caught and prevented automatic HEAD exposure on seven previously excluded GETs.
- Request-local membership/principal reuse avoids duplicate guard/handler reads;
  there is no role or consent cache spanning requests.
- Real local PostgreSQL: 100 checks passed with zero skips; Prisma runtime/SQL
  interoperability and owner/viewer/non-member test passed through actual Nest DI.
- Structural/runtime dependency graphs passed; 80 architectural fixtures passed.
- Backend suite: 455 pass, one pre-existing conditional skip. Strict API/web
  types and all seven evaluation harness checks pass. The final API image passes
  both native OCR cases and health/auth/404/SIGTERM smoke (clean exit 0).
- A native response interceptor preserves manual error/download/SSE delivery
  without duplicate sends; a regression test asserts unchanged safe failure
  bodies and zero duplicate-response warnings.
- All four current CI gates passed for `c1a0c19`
  ([run](https://github.com/willianmesko/rag-study-mvp/actions/runs/43254838430)).
  The merged source `448c91e` has an identical tree and is live in Render deploy
  `dep-dbquc3lg1s2s73888970`. Health/auth/OAuth/MCP/CORS/404 and bounded log checks
  passed. The [release receipt](../operations/release-2026-11-12-nest-native-cutover.md)
  distinguishes public smoke from full local/CI authorized behavior.
