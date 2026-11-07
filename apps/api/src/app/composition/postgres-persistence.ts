import type { Pool } from "pg";
import type { TenantMembershipRepository } from "../../modules/workspaces/application/ports/tenant-membership-repository.js";
import type { WorkspaceOnboardingRepository } from "../../modules/workspaces/application/ports/workspace-onboarding-repository.js";
import type { InvitationDeliveryRepository } from "../../modules/workspaces/application/integrations/workspace-invitations.js";
import type { InvitationDeliveryHistory } from "../../modules/workspaces/application/ports/invitation-delivery-history.js";
import { PgTenantMembershipRepository } from "../../modules/workspaces/infrastructure/postgres/pg-tenant-membership-repository.js";
import { PgWorkspaceOnboardingRepository } from "../../modules/workspaces/infrastructure/postgres/pg-workspace-onboarding-repository.js";
import { PgInvitationDeliveries } from "../../modules/workspaces/infrastructure/postgres/pg-invitation-deliveries.js";
import type { DocumentRepository } from "../../modules/knowledge/application/ports/document-repository.js";
import type { KnowledgeStatusRepository } from "../../modules/knowledge/application/ports/knowledge-status-repository.js";
import type { DemoLibraryRepository } from "../../modules/knowledge/application/ports/demo-library-repository.js";
import { PgDocumentRepository } from "../../modules/knowledge/infrastructure/postgres/pg-document-repository.js";
import { PgKnowledgeStatusRepository } from "../../modules/knowledge/infrastructure/postgres/pg-knowledge-status-repository.js";
import { PgDemoLibraryRepository } from "../../modules/knowledge/infrastructure/postgres/pg-demo-library-repository.js";
import type { UsageMetricsRepository } from "../../modules/usage/application/ports/usage-metrics-repository.js";
import type { BudgetAlertService } from "../../modules/usage/application/ports/budget-alert-service.js";
import type { QuotaRepository } from "../../modules/usage/application/ports/quota-repository.js";
import type { AuditEventRepository } from "../../modules/usage/application/ports/audit-event-repository.js";
import { PgUsageMetricsRepository } from "../../modules/usage/infrastructure/postgres/pg-usage-metrics-repository.js";
import { BudgetAlerts } from "../../modules/usage/infrastructure/observability/budget-alerts.js";
import { PgQuotaRepository } from "../../modules/usage/infrastructure/postgres/pg-quota-repository.js";
import { PgAuditEventRepository } from "../../modules/usage/infrastructure/postgres/pg-audit-event-repository.js";
import type { EvaluationRepository } from "../../modules/evaluations/application/ports/evaluation-repository.js";
import { PgEvaluationRepository } from "../../modules/evaluations/infrastructure/postgres/pg-evaluation-repository.js";
import type { McpServiceDependencies } from "../../modules/mcp/mcp.module.js";
import type { AgentActionRepository } from "../../modules/mcp/application/agent-actions/agent-action-service.js";
import type { AgentActionWorkerRepository } from "../../modules/mcp/application/agent-actions/agent-action-worker.js";
import { PgMcpControls, type McpControlLimits } from "../../modules/mcp/infrastructure/postgres/pg-mcp-controls.js";
import { PgMcpReadRepository } from "../../modules/mcp/infrastructure/postgres/pg-mcp-read-repository.js";
import { PgMcpAccessRepository } from "../../modules/mcp/infrastructure/postgres/pg-mcp-access-repository.js";
import { PgMcpOAuthRepository } from "../../modules/mcp/infrastructure/postgres/pg-mcp-oauth-repository.js";
import { PgAgentActionRepository } from "../../modules/mcp/infrastructure/postgres/pg-agent-action-repository.js";

/** Vendor selection belongs here; feature factories receive only their ports. */
export function createPostgresWorkspaceBindings(pool: Pool): {
  memberships: TenantMembershipRepository;
  workspaceOnboarding: WorkspaceOnboardingRepository;
  invitationDeliveries: InvitationDeliveryRepository & InvitationDeliveryHistory;
} {
  return {
    memberships: new PgTenantMembershipRepository(pool),
    workspaceOnboarding: new PgWorkspaceOnboardingRepository(pool),
    invitationDeliveries: new PgInvitationDeliveries(pool),
  };
}

export function createPostgresKnowledgeBindings(pool: Pool, embeddingDimensions: number): {
  documents: DocumentRepository;
  knowledgeStatus: KnowledgeStatusRepository;
  demoLibraryRepository: DemoLibraryRepository;
} {
  return {
    documents: new PgDocumentRepository(pool, embeddingDimensions),
    knowledgeStatus: new PgKnowledgeStatusRepository(pool),
    demoLibraryRepository: new PgDemoLibraryRepository(pool),
  };
}

export function createPostgresUsageBindings(pool: Pool, options: ConstructorParameters<typeof BudgetAlerts>[1]): {
  usageMetrics: UsageMetricsRepository;
  budgetAlerts: BudgetAlertService;
} {
  return { usageMetrics: new PgUsageMetricsRepository(pool), budgetAlerts: new BudgetAlerts(pool, options) };
}

export function createPostgresAccessBindings(pool: Pool): { quotas: QuotaRepository; auditEvents: AuditEventRepository } {
  return { quotas: new PgQuotaRepository(pool), auditEvents: new PgAuditEventRepository(pool) };
}

export function createPostgresEvaluationRepository(pool: Pool): EvaluationRepository {
  return new PgEvaluationRepository(pool);
}

export function createPostgresAgentActionRepository(pool: Pool): AgentActionRepository & AgentActionWorkerRepository {
  return new PgAgentActionRepository(pool, (client, result) => new PgEvaluationRepository(client).create(result));
}

export function createPostgresMcpBindings(pool: Pool, readPool: Pool | null, limits: McpControlLimits):
  Pick<McpServiceDependencies, "access" | "reads" | "oauth" | "actions" | "controls"> {
  return {
    access: new PgMcpAccessRepository(pool),
    reads: readPool ? new PgMcpReadRepository(readPool) : null,
    oauth: new PgMcpOAuthRepository(pool),
    actions: createPostgresAgentActionRepository(pool),
    controls: new PgMcpControls(pool, limits),
  };
}
