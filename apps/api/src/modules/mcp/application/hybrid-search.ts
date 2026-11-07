import {withProviderUsageScope} from "../../../platform/observability/provider-usage-context.js";
import { Buffer } from "node:buffer";
import type { EmbeddingModelIdentity } from "../../ai/index.js";
import type { EmbeddingProvider } from "../../ai/index.js";
import type { McpSearchRecord } from "./read-tools.js";
import { redactPii } from "../../../platform/security/pii-redaction.js";
import { toLexicalQuery } from "../../knowledge/index.js";
import { withExecutionTimeout } from "./policies/agent-execution-policy.js";

export type McpSearchInput = { tenantId: string; userId: string; query: string; limit: number; signal: AbortSignal };
export interface McpSearch {
  execute(input: McpSearchInput): Promise<McpSearchRecord[]>;
}
export interface McpHybridReadRepository {
  activeIndex(tenantId: string, signal: AbortSignal): Promise<(EmbeddingModelIdentity & { revision: string }) | null>;
  hybrid(input: { tenantId: string; revision: string; embedding: number[]; lexicalQuery: string; limit: number; signal: AbortSignal }): Promise<McpSearchRecord[]>;
}
export interface McpProviderBudget {
  reserve(input: { tenantId: string; userId: string; inputTokens: number; costNanoUsd: number; signal: AbortSignal }): Promise<string | null>;
  finishReservation(reservationId: string): Promise<void>;
}
export class McpBudgetExceededError extends Error {
  constructor() { super("The MCP provider budget was reached."); this.name = "McpBudgetExceededError"; }
}
export class McpIndexUnavailableError extends Error {
  constructor() { super("The workspace needs a supported active embedding index."); this.name = "McpIndexUnavailableError"; }
}

/** Exactly one embedding request; no generation, rewrite, fallback or reranker. */
export class McpHybridSearch implements McpSearch {
  constructor(private readonly reads: McpHybridReadRepository,
    private readonly budgets: McpProviderBudget,
    private readonly provider: (identity: EmbeddingModelIdentity,tenantId?:string) => EmbeddingProvider,
    private readonly prices: readonly (EmbeddingModelIdentity & { inputCostPer1kUsd: number })[],
    private readonly limits: { maxInputTokens: number; maxCostNanoUsd: number }) {}

  async execute(input: McpSearchInput): Promise<McpSearchRecord[]> {
    input.signal.throwIfAborted();
    const query = redactPii(input.query).text.replace(/\[REDACTED_[A-Z_]+\]/g, " ").trim();
    if (!query) return [];
    const index = await this.reads.activeIndex(input.tenantId, input.signal);
    const price = index && this.prices.find((item) => item.provider === index.provider && item.model === index.model && item.dimensions === index.dimensions);
    if (!index || !price || !Number.isFinite(price.inputCostPer1kUsd) || price.inputCostPer1kUsd < 0) throw new McpIndexUnavailableError();
    // UTF-8 byte length is a conservative input-token bound for supported
    // adapters. Reserve additional fixed overhead, and retain reservations on
    // errors: a cancelled request may already have been billed upstream.
    const inputTokens = Buffer.byteLength(query, "utf8") + 64;
    const costNanoUsd = Math.ceil(inputTokens * price.inputCostPer1kUsd * 1_000_000);
    if (inputTokens > this.limits.maxInputTokens || costNanoUsd > this.limits.maxCostNanoUsd) throw new McpBudgetExceededError();
    const reservation = await this.budgets.reserve({ tenantId: input.tenantId, userId: input.userId, inputTokens, costNanoUsd, signal: input.signal });
    if (!reservation) throw new McpBudgetExceededError();
    try {
      input.signal.throwIfAborted();
      const embedding = await withExecutionTimeout((signal) => withProviderUsageScope({tenantId:input.tenantId,actorKey:`user:${input.userId}`},()=>this.provider(index,input.tenantId).embed(query, "query", signal)), 5_000, input.signal);
      input.signal.throwIfAborted();
      return await this.reads.hybrid({ tenantId: input.tenantId, revision: index.revision,
        embedding, lexicalQuery: toLexicalQuery(query), limit: input.limit, signal: input.signal });
    } finally {
      await this.budgets.finishReservation(reservation);
    }
  }
}
