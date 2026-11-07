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

export async function withExecutionTimeout<T>(task: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parentSignal?: AbortSignal): Promise<T> {
  const deadline = new AbortController();
  const signal = parentSignal ? AbortSignal.any([parentSignal, deadline.signal]) : deadline.signal;
  signal.throwIfAborted();
  let onAbort: () => void = () => undefined;
  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const timeout = setTimeout(() => deadline.abort(new Error("Agent execution timed out.")), timeoutMs);
  try {
    return await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return task(signal); }), interrupted]);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
  }
}
