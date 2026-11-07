# ADR 0002: Organize the backend around business modules

- Date: 2026-11-07
- Status: accepted; implemented and locally verified, publication pending
- Scope: backend source organization and composition

## Problem

Top-level `application/use-cases`, `application/ports`, `infrastructure/postgres`
and `interfaces/http` separate technical roles but scatter one feature across the
repository. Adding a workspace capability requires opening unrelated global
directories. Extracted route plugins improve file size, but do not solve feature
ownership or discoverability on their own.

The product owner requested a structure closer to NestJS feature modules. The
useful properties are cohesive feature ownership, explicit providers, small
controllers and deliberate exports. These can use the existing Fastify plugin
model and native TypeScript constructor/factory injection.

## Decision

Use a modular monolith. Group feature code under `src/modules` and technical
facilities under `src/platform`. The application composition root assembles
module providers and HTTP controllers. Existing use-case classes remain the
services that implement behavior; do not add forwarding service classes just
to introduce a new filename convention.

```text
src/
  app/                         # Global composition and HTTP lifecycle
  modules/
    identity/                  # Verified identity and scoped account lookup
    workspaces/                # Memberships, invitations and onboarding
    knowledge/                 # Library, document access and retrieval
    ingestion/                 # Uploads, extraction, OCR and indexing jobs
    chat/                      # Answers, conversations, streaming and cache
    ai/                        # Model ports, provider adapters and guard policies
    evaluations/               # Datasets, judges, comparisons and reports
    mcp/                       # Scoped tools, OAuth and approved-action boundary
    usage/                     # Quotas, ledger, audit and budget notifications
    workflows/                 # Authorized product workflow orchestration
  platform/
    database/                  # Pools, SQL limits, fencing and transaction helpers
    http/                      # Bounded external transport and HTTP utilities
    observability/             # Safe events, correlation and telemetry transport
    security/                  # Shared redaction and input-risk primitives
    workflows/                 # Generic execution, leases, checkpointing and crypto
    lifecycle/                 # Process shutdown
    integrations/              # Retry classification and backoff
  interfaces/cli/              # Existing operational command entry points
  interfaces/mcp/stdio.ts      # Stable restricted client launcher
  config.ts
  server.ts
```

Create only directories a module actually needs. For example:

```text
modules/ingestion/
  ingestion.module.ts          # Explicit provider assembly
  ingestion.controller.ts      # Fastify request/response adapter
  index.ts                     # Named public exports used by other modules
  application/
    ports/
    use-cases/
  infrastructure/
    extraction/
    postgres/
  ...co-located tests
```

Controllers validate HTTP inputs and apply authorization, then call injected
capabilities. Application services depend on ports and pure policy. Adapters own
Supabase, PostgreSQL, provider SDK and file-format integration. Module factories
create and expose the required providers. The root owns resource lifecycle once;
features do not create independent pools or background timers implicitly.

Modules consume named public exports from other modules. The application
composition root may assemble concrete adapters. Module-internal imports remain
relative. Keep type-only dependencies erased and check runtime cycles separately;
do not solve a cycle by importing an entire module's composition factory through
its public barrel. Shared contracts in `packages/contracts` remain the HTTP DTO
and validation source of truth.

## Trade-offs and validation

Feature ownership becomes easier to follow, while shared transactional/workflow
code still requires explicit cross-feature coordination. A folder move alone does
not improve scalability or security. Public exports, dependency checks, existing
authorization and transaction boundaries provide the corresponding guarantees.

Move code without changing routes, payloads, database schema, lease fencing or
provider-call identity. Update imports, operational scripts and asset-relative
paths. Preserve the published Node and MCP launch commands. Run strict type
checks, architecture fixtures, API tests, real disposable PostgreSQL suites,
evaluation gates, responsive UX and the image-level OCR smoke test before
publishing. Record remaining migration scope and deployment evidence separately.

This decision introduces no NestJS dependency, decorators, generic DI container,
repository framework or hosting service. A later framework migration would need
its own demonstrated benefit and compatibility review.

## References

- [NestJS feature modules and explicit exports](https://docs.nestjs.com/modules)
- [Fastify plugin encapsulation](https://fastify.dev/docs/latest/Guides/Plugins-Guide/)
- [Technical backlog](../technical-backlog.md)
