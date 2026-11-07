import type { Pool } from "pg";
import type { RuntimeConfiguration } from "../configuration/environment.js";
import type { WorkflowEngine } from "../../platform/workflows/types.js";
import type { WorkspaceWorkflowOptions } from "../../modules/workflows/application/ports/workspace-workflow-options.js";
import { DurableWorkflowRunner } from "../../platform/workflows/durable-workflow-runner.js";
import { PgWorkflowRepository } from "../../platform/workflows/pg-workflow-repository.js";
import { PgWorkflowCheckpointer } from "../../platform/workflows/pg-workflow-checkpointer.js";
import { workflowCodecFromEnvironment } from "../../platform/workflows/workflow-state-codec.js";

type WorkflowRuntimeConfiguration = Pick<RuntimeConfiguration, "WORKFLOWS_ENABLED" | "WORKFLOW_STATE_KEY" | "WORKFLOW_STATE_KEYS" | "WORKFLOW_STATE_ACTIVE_KEY_ID">;

export function workspaceWorkflowOptionsFromConfiguration(configuration: RuntimeConfiguration): WorkspaceWorkflowOptions {
  return {
    chatMaxOutputTokens: configuration.CHAT_MAX_OUTPUT_TOKENS,
    chatMaxEstimatedCostUsd: configuration.MAX_ESTIMATED_COST_USD_PER_REQUEST,
    chatTimeoutMs: configuration.AGENT_TIMEOUT_MS,
    evaluationMaxCostUsd: configuration.WORKFLOW_EVAL_MAX_COST_USD,
  };
}

/** Persisted formats belong to this adapter binding, never to product modules. */
export function createWorkflowRuntime(pool: Pool, configuration: WorkflowRuntimeConfiguration, reportFailure: (code: string) => void): WorkflowEngine | undefined {
  const codec = configuration.WORKFLOWS_ENABLED ? workflowCodecFromEnvironment(configuration) : undefined;
  if (!codec) return undefined;
  const repository = new PgWorkflowRepository(pool, codec);
  return new DurableWorkflowRunner(repository, (lease, graph) => new PgWorkflowCheckpointer(repository, lease, graph), reportFailure);
}
