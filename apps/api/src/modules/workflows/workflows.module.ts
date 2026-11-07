import type { Pool } from "pg";
import type { config } from "../../config.js";
import type { ChatRuntimeBindings } from "../chat/index.js";
import type { RunEvaluationUseCase } from "../evaluations/index.js";
import type { TenantMembershipRepository } from "../workspaces/index.js";
import type { WorkflowEngine } from "../../platform/workflows/types.js";
import { DurableWorkflowRunner } from "../../platform/workflows/durable-workflow-runner.js";
import { PgWorkflowRepository } from "../../platform/workflows/pg-workflow-repository.js";
import { PgWorkflowCheckpointer } from "../../platform/workflows/pg-workflow-checkpointer.js";
import { workflowCodecFromEnvironment } from "../../platform/workflows/workflow-state-codec.js";
import { WorkspaceWorkflows } from "./application/workspace-workflows.js";

type WorkflowRuntimeConfiguration = Pick<typeof config, "WORKFLOWS_ENABLED" | "WORKFLOW_STATE_KEY" | "WORKFLOW_STATE_KEYS" | "WORKFLOW_STATE_ACTIVE_KEY_ID">;
type WorkflowBudgetConfiguration = Pick<typeof config, "CHAT_MAX_OUTPUT_TOKENS" | "MAX_ESTIMATED_COST_USD_PER_REQUEST" | "AGENT_TIMEOUT_MS" | "WORKFLOW_EVAL_MAX_COST_USD">;

/** Create the shared runtime before evaluation and ingestion definitions bind to it. */
export function createWorkflowRuntime(pool: Pool, configuration: WorkflowRuntimeConfiguration, reportFailure: (code: string) => void) {
  const codec = configuration.WORKFLOWS_ENABLED ? workflowCodecFromEnvironment(configuration) : undefined;
  if (!codec) return undefined;
  const repository = new PgWorkflowRepository(pool, codec);
  return new DurableWorkflowRunner(repository, (lease, graph) => new PgWorkflowCheckpointer(repository, lease, graph), reportFailure);
}

/** All product workflows register once against the same application-owned engine. */
export function createWorkspaceWorkflowServices(dependencies: {
  engine?: WorkflowEngine;
  chat: ChatRuntimeBindings;
  runEvaluation: Pick<RunEvaluationUseCase, "execute" | "preflight">;
  evaluationVersion: string;
  member: TenantMembershipRepository["findByUserAndTenant"];
  embeddingVersion: (tenantId: string) => Promise<string>;
  configuration: WorkflowBudgetConfiguration;
}) {
  const { engine, chat, runEvaluation, evaluationVersion, member, embeddingVersion, configuration } = dependencies;
  if (!engine) return undefined;
  return new WorkspaceWorkflows({
    engine, chatVersion: chat.chatVersion, evaluationVersion,
    chatBudget: {
      maxSteps: 50, maxCalls: 16, maxInputTokens: 320_000,
      maxOutputTokens: Math.min(64_000, configuration.CHAT_MAX_OUTPUT_TOKENS * 4 + 3_600),
      maxCostMicros: Math.floor(configuration.MAX_ESTIMATED_COST_USD_PER_REQUEST * 1_000_000), timeoutMs: configuration.AGENT_TIMEOUT_MS,
    },
    evaluationBudget: {
      maxSteps: 50, maxCalls: 32, maxInputTokens: 500_000, maxOutputTokens: 16_000,
      maxCostMicros: Math.floor(configuration.WORKFLOW_EVAL_MAX_COST_USD * 1_000_000), timeoutMs: 120_000,
    },
    member, resolveChat: chat.resolveChat, embeddingVersion,
    consumeQuota: chat.consumeQuota, runChat: chat.runChat, runEvaluation,
  });
}
