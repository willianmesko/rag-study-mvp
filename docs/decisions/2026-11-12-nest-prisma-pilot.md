# NestJS/Fastify migration and Prisma pilot

Status: implemented increment; local and remote CI verified. Not deployed.

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
- Existing route plugins are registered on the same Fastify instance under an
  encapsulated compatibility scope. Paths, authentication, workspace selection,
  rate limits, body limits, SSE and cancellation are retained.

```mermaid
flowchart TD
  Entry[API entry point] --> Nest[Nest application and DI]
  Nest --> Health[Native HealthController]
  Nest --> Legacy[Fastify compatibility route plugins]
  Nest --> Factory[Transitional application factory]
  Nest --> PrismaModule[PilotPersistenceModule]
  PrismaModule --> Port[WorkspaceModelPolicyRepository]
  Port --> Prisma[Prisma adapter]
  Prisma --> Existing[(Existing workspace_chat_model_policies)]
  Factory --> SQL[Existing SQL repositories and pgvector]
  Legacy --> Factory
```

## What remains transitional

Most business controllers still use their tested Fastify route plugins, and most
feature construction remains in `createApplication`. A Nest factory provider
owns that composition as a bridge; this is not a claim that every feature is
already an independent Nest module. Future increments should migrate one feature's
controller, guards, services and providers at a time. Application/domain ports
remain independent of Nest and Prisma.

The standalone CLI and MCP entry points retain their current compositions.
The legacy SQL model-policy adapter remains for those entry points and rollback;
the production API runtime receives the Prisma adapter through Nest DI.

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
errors. Compatibility plugins therefore retain their existing Fastify error
policy in their own scope. A Nest exception filter reuses that policy for
Nest-owned/global failures and unwraps Fastify's mapped causes. Error contents
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

Verification status is recorded in the technical backlog. No production rollout
or hosted load-capacity claim follows from these local tests.

## Next increments

1. Migrate model-policy/catalog HTTP handlers to native Nest controllers/guards
   while preserving per-route body limits and disabled automatic HEAD routes.
2. Move feature construction from the transitional factory into feature Nest
   modules with explicit port tokens. Keep use cases framework independent.
3. Pilot Prisma on another ordinary CRUD repository only after reviewing its
   transactions, RLS and concurrency invariants. Retain specialized retrieval,
   leases, outbox and vector SQL until an equivalent is measured and verified.
4. Validate CI, runtime images and a staging/production smoke before rollout;
   verify real streaming, cancellation, authentication and usage traces there.
