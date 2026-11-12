# Prisma migration inventory

The Nest framework migration is complete for the current API surface: ten
business modules, native HTTP controllers/guards, and runtime modules are wired
through Nest DI. That is separate from persistence migration.

## Counting rules

Count logical implementations named `Pg*Repository` once, including the technical
workflow repository. There are **18**. Model policies use Prisma in the API;
audit events are now the second published migration at `1d451f7`.
Current API selection: **2/18 Prisma, 16/18 SQL**.
Retained legacy implementations are rollback/standalone adapters, not additional
logical repositories. CLI/MCP stdio compositions still select legacy SQL adapters.

Six additional PostgreSQL adapters are not named Repository: embedding indexes,
semantic cache, invitation deliveries, MCP budgets/controls, graph checkpoints
and the SQL-backed budget-alert service (whose class is not prefixed `Pg`).
Thus the broader persistence inventory is **24 logical adapters**. Do not confuse
24 adapters with 24 business modules or interpret all SQL as a migration defect.

## Named repositories

| Repository | Area | API implementation / migration considerations |
| --- | --- | --- |
| WorkspaceModelPolicy | Chat | Prisma; existing policy allowlist and tenant scope |
| AuditEvent | Usage | Prisma; append-only, shared bounded pool, fail-closed audit |
| WorkspaceOnboarding | Workspaces | SQL; atomic monotonic progress/goal merge must survive concurrent devices |
| TenantMembership | Workspaces | SQL; owner, membership, invitation and transaction invariants |
| Document | Knowledge | SQL; pgvector/hybrid retrieval, versioning, transactional changes |
| KnowledgeStatus | Knowledge | SQL; scoped aggregate queries and quality/status projections |
| DemoLibrary | Knowledge | SQL; idempotent imports and concurrency |
| IngestionJob | Ingestion | SQL; leases, SKIP LOCKED, fencing, events, idempotent admission |
| ChatRun | Chat | SQL; durable replay/status, ownership and leases |
| Conversation | Chat | SQL; ordered messages, idempotent turns, ownership and retention |
| Evaluation | Evaluations | SQL; workflow fence and partial-index idempotency |
| Quota | Usage | SQL; atomic counters, reservations and concurrent budgets |
| UsageMetrics | Usage | SQL; ledger, aggregations, provider accounting and retention |
| McpAccess | MCP | SQL; hashed credentials, membership revocation and access limits |
| McpRead | MCP | SQL; scoped read-only transactions, hybrid/vector search and bounded previews |
| McpOAuth | MCP | SQL; single-use codes, refresh rotation, replay revocation and consent |
| AgentAction | MCP | SQL; approval, leased effects, retries and transactional evaluation records |
| Workflow | Platform | SQL; durable checkpoints/effects, fencing, approval and cancellation |

## Other PostgreSQL adapters/services retained

| Adapter | Reason for explicit review before replacing it |
| --- | --- |
| WorkspaceEmbeddingIndex | Dimension/version validation and atomic activation/reindex |
| SemanticAnswerCache | Workspace/model isolation and vector similarity |
| InvitationDeliveries | Outbox/retry/dead-letter and delivery deduplication |
| McpControls | Atomic provider reservations, quotas and cancellation |
| WorkflowCheckpointer | LangGraph persistence and durable write/checkpoint semantics |
| BudgetAlerts | SQL-backed alert thresholds, outbox delivery, retries and repair |

## Next acceptance criteria

A candidate must preserve public behavior, SQL interoperability, tenant isolation,
RLS, concurrency and failure semantics. Compare emitted queries, pool usage and
latency with the existing implementation; publish synthetic local results without
claiming hosted capacity. Use existing Prisma/client/adapter versions and pool;
keep SQL migrations authoritative. No `prisma db push`, automatic schema migration,
blanket ORM rewrite or SDK replacement is part of this inventory.

For the audit release, see the [decision and validation](decisions/2026-11-12-prisma-audit-events.md).

[Audit production receipt](operations/release-2026-11-12-prisma-audit-events.md)
records CI, measurements, deployed source and authenticated verification.
