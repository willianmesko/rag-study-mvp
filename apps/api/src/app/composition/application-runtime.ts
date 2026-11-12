import type { DocumentFilters } from "@rag-study/contracts";
import { closeApplicationResources } from "../../platform/lifecycle/resources.js";
import type { RuntimeConfiguration } from "../configuration/environment.js";
import type { AiRuntime } from './ai-runtime.js';
import type { ChatRuntime } from './chat-runtime.js';
import type { CoreRuntime } from './core-runtime.js';
import type { EvaluationsRuntime } from './evaluations-runtime.js';
import type { IngestionRuntime } from './ingestion-runtime.js';
import type { KnowledgeRuntime } from './knowledge-runtime.js';
import type { McpRuntime } from './mcp-runtime.js';
import type { UsageRuntime } from './usage-runtime.js';
import type { WorkflowsRuntime } from './workflows-runtime.js';
import type { WorkspacesRuntime } from './workspaces-runtime.js';
export function assembleApplicationRuntime(config: RuntimeConfiguration, core: CoreRuntime, usage: UsageRuntime, workspaces: WorkspacesRuntime, _ai: AiRuntime, knowledge: KnowledgeRuntime, chat: ChatRuntime, evaluations: EvaluationsRuntime, workflowRuntime: WorkflowsRuntime, ingestion: IngestionRuntime, mcp: McpRuntime) {
    const { identityServices, pool, mcpReadPool, jobs, quotas, auditEvents, chatRuns, conversations, semanticCache, workspaceModelPolicies, engine } = core;
    const { budgetAlerts, usageMetrics } = usage;
    const { memberships, workspaceOnboarding, invitationDeliveries, inviteWorkspaceMember } = workspaces;
    const { documents, knowledgeStatus, demoLibraryRepository, searchDocuments, getDocumentOriginal, deleteDocument } = knowledge;
    const { chatModels, defaultChat, compareAnswers, routeAnswer } = chat;
    const { runEvaluation, listEvaluationRuns } = evaluations;
    const { workflows } = workflowRuntime;
    const { ingestDocument, queueDocumentUpload, publicHtmlFetcher, processNextIngestionJob, retryIngestionJob, reindexDocument } = ingestion;
    const { mcpServices } = mcp;
    return {
        useCases: {
            ...identityServices,
            ingestDocument,
            demoLibraryRepository,
            queueDocumentUpload,
            publicHtmlFetcher,
            processNextIngestionJob,
            retryIngestionJob,
            listIngestionJobs: (tenantId: string, limit: number) => jobs.list(tenantId, limit),
            listIngestionEvents: (jobId: string, tenantId: string, limit: number) => jobs.listEvents(jobId, tenantId, limit),
            previewIngestionPassages: jobs.previewPassages.bind(jobs),
            listMemberships: memberships.listByUserId.bind(memberships),
            findMembership: memberships.findByUserAndTenant.bind(memberships),
            createWorkspace: memberships.createWorkspace.bind(memberships),
            listWorkspaceMembers: memberships.listMembers.bind(memberships),
            addWorkspaceMember: memberships.addMember.bind(memberships),
            changeWorkspaceMemberRole: memberships.changeMemberRole.bind(memberships),
            removeWorkspaceMember: memberships.removeMember.bind(memberships),
            recordWorkspaceInvitation: memberships.recordInvitation.bind(memberships),
            listDocuments: (tenantId: string, limit: number, filters?: DocumentFilters) => documents.list(tenantId, limit, filters),
            knowledgeStatus,
            listDocumentChunks: (tenantId: string, documentId: string, limit: number) => documents.listChunks({ tenantId, documentId, limit }),
            getDocumentOriginal,
            reindexDocument,
            deleteDocument,
            consumeQuestionQuota: (tenantId: string, actorKey: string, units?: 1 | 2, receiptKey?: string) => quotas.consumeQuestion({
                tenantId,
                actorKey,
                units,
                receiptKey,
                tenantLimit: config.DAILY_TENANT_QA_LIMIT,
                actorLimit: config.DAILY_USER_QA_LIMIT,
            }),
            consumeAdminUploadQuota: (tenantId: string, actorKey: string, bytes: number) => quotas.consumeUpload({
                tenantId,
                actorKey,
                bytes,
                limit: config.DAILY_ADMIN_UPLOAD_BYTES_LIMIT,
            }),
            getUsageSummary: (tenantId: string, days: number) => usageMetrics.summarize({ tenantId, days }),
            listEvaluationRuns,
            runEvaluation,
            invalidateSemanticCache: (tenantId: string) => semanticCache.invalidateTenant(tenantId),
            recordAuditEvent: auditEvents.record.bind(auditEvents),
            budgetAlerts,
            inviteWorkspaceMember,
            listInvitationDeliveries: invitationDeliveries.list.bind(invitationDeliveries),
            pruneInvitationDeliveries: invitationDeliveries.prune.bind(invitationDeliveries),
            searchDocuments,
            chatRuns,
            conversations,
            workflows,
            cancelIngestion: async (tenantId: string, jobId: string) => {
                const changed = await jobs.cancel(jobId, tenantId);
                if (changed)
                    await engine?.cancel({
                        tenantId,
                        actorId: "ingestion",
                        runId: jobId,
                    });
                return changed;
            },
            workspaceOnboarding,
            chatModels,
            workspaceModelPolicies,
            ...mcpServices,
            compareAnswers,
            routeAnswer,
            answerQuestion: defaultChat.answerQuestion,
        },
        close: () => closeApplicationResources({ workflows, pool, mcpReadPool }),
    };
}
