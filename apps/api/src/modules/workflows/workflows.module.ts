import type { ChatRuntimeBindings } from "../chat/index.js";
import type { RunEvaluationUseCase } from "../evaluations/index.js";
import type { TenantMembershipRepository } from "../workspaces/index.js";
import type { WorkflowEngine } from "../../platform/workflows/types.js";
import type { WorkspaceWorkflowOptions } from "./application/ports/workspace-workflow-options.js";
import { WorkspaceWorkflows } from "./application/workspace-workflows.js";

/** All product workflows register once against the same application-owned engine. */
export function createWorkspaceWorkflowServices(dependencies: {
  engine?: WorkflowEngine;
  chat: ChatRuntimeBindings;
  runEvaluation: Pick<RunEvaluationUseCase, "execute" | "preflight">;
  evaluationVersion: string;
  member: TenantMembershipRepository["findByUserAndTenant"];
  embeddingVersion: (tenantId: string) => Promise<string>;
  options: WorkspaceWorkflowOptions;
}) {
  const { engine, chat, runEvaluation, evaluationVersion, member, embeddingVersion, options } = dependencies;
  if (!engine) return undefined;
  return new WorkspaceWorkflows({
    engine, chatVersion: chat.chatVersion, evaluationVersion,
    chatBudget: {
      maxSteps: 50, maxCalls: 16, maxInputTokens: 320_000,
      maxOutputTokens: Math.min(64_000, options.chatMaxOutputTokens * 4 + 3_600),
      maxCostMicros: Math.floor(options.chatMaxEstimatedCostUsd * 1_000_000), timeoutMs: options.chatTimeoutMs,
    },
    evaluationBudget: {
      maxSteps: 50, maxCalls: 32, maxInputTokens: 500_000, maxOutputTokens: 16_000,
      maxCostMicros: Math.floor(options.evaluationMaxCostUsd * 1_000_000), timeoutMs: 120_000,
    },
    member, resolveChat: chat.resolveChat, embeddingVersion,
    consumeQuota: chat.consumeQuota, runChat: chat.runChat, runEvaluation,
  });
}
