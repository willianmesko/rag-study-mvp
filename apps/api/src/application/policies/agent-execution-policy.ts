import { z } from "zod";

export const agentExecutionBudgetSchema = z.object({
  maxSteps: z.number().int().min(1).max(50),
  maxToolCalls: z.number().int().min(0).max(50),
  maxOutputTokens: z.number().int().min(1).max(16_000),
  maxEstimatedCostUsd: z.number().min(0).max(100),
  timeoutMs: z.number().int().min(1_000).max(120_000)
});

export type AgentExecutionBudget = z.infer<typeof agentExecutionBudgetSchema>;

export const toolDefinitionSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  mode: z.enum(["read_only", "write"]),
  requiresApproval: z.boolean(),
  scopes: z.array(z.enum(["workspace", "documents", "evaluations", "external"])).min(1)
});

export type ToolDefinition = z.infer<typeof toolDefinitionSchema>;

export const readOnlyWorkspaceTools: readonly ToolDefinition[] = [
  { name: "search_workspace", mode: "read_only", requiresApproval: false, scopes: ["workspace", "documents"] },
  { name: "get_document", mode: "read_only", requiresApproval: false, scopes: ["workspace", "documents"] },
  { name: "list_sources", mode: "read_only", requiresApproval: false, scopes: ["workspace", "documents"] },
  { name: "get_ingestion_status", mode: "read_only", requiresApproval: false, scopes: ["workspace", "documents"] },
  { name: "get_quality_report", mode: "read_only", requiresApproval: false, scopes: ["workspace", "evaluations"] }
];

export function assertStepBudget(step: number, budget: Pick<AgentExecutionBudget, "maxSteps">): number {
  if (step > budget.maxSteps) throw new Error("Agent step budget exceeded.");
  return step;
}

export function assertToolAllowed(toolName: string, tools: readonly ToolDefinition[], budget: Pick<AgentExecutionBudget, "maxToolCalls">, toolCalls: number): void {
  const tool = tools.find((candidate) => candidate.name === toolName);
  if (!tool) throw new Error(`Tool is not allowlisted: ${toolName}`);
  if (tool.mode !== "read_only" || tool.requiresApproval) throw new Error(`Tool requires an approval gate: ${toolName}`);
  if (toolCalls >= budget.maxToolCalls) throw new Error("Agent tool-call budget exceeded.");
}

export async function withExecutionTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Agent execution timed out.")), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
