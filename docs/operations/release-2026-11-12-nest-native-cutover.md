# Native NestJS API cutover

## Source and scope

- Implementation: `c1a0c198ea96637e35d6039cd9665e490d61ad3c`.
- Merged API source: `448c91ecdc3b1aa587d00948c06c8af9ec7614ef`.
- Both commits have the same source tree: `64934aa917cce36c526daab248b0491fcd47b99d`.
- [Merged pull request](https://github.com/willianmesko/rag-study-mvp/pull/1).
- [Four passing quality gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/43254838430).

Native Nest controllers and access guards now own the existing workspace/team,
knowledge, ingestion, chat/models, conversations, evaluations, usage and MCP/
OAuth endpoints. Ten runtime modules use Nest DI and small reusable outer
factories; the API no longer calls the transitional `createApplication`.
Application/domain ports remain independent of Nest, Prisma and vendor SDKs.

The Prisma pilot implements only workspace model policies against the existing
SQL schema. No schema rewrite, hosted migration or paid model call was required.
SQL migrations, pgvector, RLS, leases, transactions and outbox remain unchanged.

## Validation

- 455 backend cases pass, with one pre-existing conditional skip.
- Native and compatibility route inventories match: 55 method/path entries
  with optional features disabled, 98 enabled. Includes HEAD, body and rate limits.
- Automatic HEAD is disabled to preserve the original exclusions for SSE,
  downloads and other explicitly bounded reads. HEAD contracts are explicit.
- Guard/handler decisions are reused only within each request; membership and
  grant changes are checked again on subsequent requests. Ongoing MCP calls
  retain independent revocation polling and cancellation.
- Native response interception prevents duplicate sends for manually delivered
  JSON/errors, binary downloads and SSE. The safe-body regression asserts no
  duplicate-response warning.
- Strict API/web types, both dependency graphs and 80 architecture fixtures pass.
- Seven evaluation harness checks pass, including golden set, injection,
  reviewed replay regression and Promptfoo. These use bounded fixtures, not
  provider latency or production-capacity measurements.
- 100 real PostgreSQL checks pass with zero skips, including durable conversation
  HTTP, OAuth, tenant isolation, workflows and replay/rotation behavior.
- The Prisma integration passes through actual Nest DI: SQL interoperability,
  per-tenant model policies, owner/viewer/non-member permissions, checked stored
  records, RLS and pool disposal.
- The final API image passes two native OCR cases. Image smoke covers health 200,
  private access 401, original 404 response shape, SIGTERM exit 0 and no duplicate
  reply warnings. A second boot with MCP/OAuth/actions enabled verifies discovery
  200, an unauthenticated remote-MCP challenge 401 and clean shutdown.
- All 31 SQL migrations retain SHA-256
  `f3d3581a9a83a1568390cc0d249968dcec8016d09596a1004e043f6d711c253b`.

## Deployment

Render API deploy `dep-dbquc3lg1s2s73888970` targets merged source `448c91e`.
Render confirmed **live** at `2026-11-12T16:18:01Z` (13:18 in São Paulo).
The deployed source matches `448c91e`. Public checks after activation passed:

| Check | Observed result |
| --- | --- |
| `/health` | 200; OCR, durable workflows and durable conversations enabled |
| Model-policy, workspace, conversation, document and model-catalog reads without login | 401 |
| OAuth authorization-server discovery | 200; expected production issuer |
| Remote MCP without credential | 401; expected resource-metadata challenge |
| Invalid OAuth form request | 400; safe `invalid_request` protocol response |
| Frontend-origin QA preflight | 204; correct allow-origin header |
| Unknown API path | 404; preserved safe response shape |
| Existing frontend HTML | 200; Lumora document |

A bounded post-activation error-log query and duplicate-reply query returned no
matching entries. This is an observation window, not a long-term reliability
claim. No frontend source changed or new frontend release was needed. No real
private document or paid AI completion was read/generated for the public smoke;
full authorized behavior is covered by the local/CI suites above.

## Remaining work and rollback

A second Prisma CRUD candidate requires a separately reviewed benchmark and
concurrency/RLS acceptance criteria. This cutover does not certify hosted load
capacity or activate LangSmith. Those operational items remain separately tracked.

The pre-cutover Render API deploy is `dep-dbodgfh5efls73didn00`, at source `d94f651`.
There is no new DDL to undo. If rollback is necessary, verify current configuration
compatibility and use a retained compatible build; a rollback does not undo
background effects or restore database state. Inspect startup/health/auth errors
before retrying. The existing shutdown coordinator stops admission, cancels
streams, drains background work, closes Nest-managed pools and flushes telemetry.
