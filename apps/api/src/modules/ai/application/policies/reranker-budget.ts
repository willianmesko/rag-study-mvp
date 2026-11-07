import type { RerankInput } from "../ports/reranker.js";
import { redactPii } from "../../../../platform/security/pii-redaction.js";
import { WorkflowGuardError, type Reservation } from "../../../../platform/workflows/types.js";

export type RerankerBillingPolicy =
  | { billing: "local" }
  | {
      billing: "paid";
      provider: string;
      model: string;
      inputCostPer1kUsd?: number;
      maxCostMicros?: number;
    };

export const rerankerInputLimits = {
  maxCandidates: 100,
  maxQueryBytes: 4_096,
  maxCandidateBytes: 16_384,
  maxTotalBytes: 262_144,
  maxCostMicros: 10_000,
} as const;

export class RerankerBudgetError extends WorkflowGuardError {
  constructor(readonly reason: "reranker_price_unavailable" | "reranker_input_limit" | "reranker_cost_limit" | "reranker_invalid_usage") {
    super("budget_exceeded");
    this.name = "RerankerBudgetError";
  }
}

function conservativeBytes(text: string) {
  // Account for compatibility normalization performed by text tokenizers as
  // well as the PII replacement strings actually sent by the Jina adapter.
  const safe = redactPii(text).text;
  return Math.max(Buffer.byteLength(safe), Buffer.byteLength(safe.normalize("NFKC")));
}

/** A conservative reservation, not a claim about exact provider tokenization or
 * the invoice. Repeat the query/overhead across small document windows because
 * pointwise rerankers can split long passages internally. Native overruns must
 * still stop the run; a charge already incurred cannot be reversed by code. */
export function planRerankerReservation(input: RerankInput, policy?: RerankerBillingPolicy): {
  amount: Reservation;
  identity: { provider: string; model: string };
  inputTokens: number;
  costMicros: number;
} {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > rerankerInputLimits.maxCandidates ||
      input.candidates.length > rerankerInputLimits.maxCandidates ||
      input.query.length > rerankerInputLimits.maxQueryBytes ||
      input.candidates.some(({ content }) => content.length > rerankerInputLimits.maxCandidateBytes)) {
    throw new RerankerBudgetError("reranker_input_limit");
  }
  const queryBytes = conservativeBytes(input.query);
  if (queryBytes > rerankerInputLimits.maxQueryBytes)
    throw new RerankerBudgetError("reranker_input_limit");
  let totalBytes = queryBytes, inputTokens = 256;
  for (const candidate of input.candidates) {
    const bytes = conservativeBytes(candidate.content);
    totalBytes += bytes;
    if (bytes > rerankerInputLimits.maxCandidateBytes || totalBytes > rerankerInputLimits.maxTotalBytes)
      throw new RerankerBudgetError("reranker_input_limit");
    inputTokens += bytes + Math.max(1, Math.ceil(bytes / 256)) * (queryBytes + 128);
  }
  // This deliberately over-reserves relative to bytes/4 ledger estimates. It
  // provides headroom for tokenizer overhead and internal document windows.
  inputTokens *= 2;
  if (policy?.billing === "local") {
    return { amount: { calls: 1 }, identity: { provider: "local", model: "local" }, inputTokens: 0, costMicros: 0 };
  }
  if (!policy || !/^[A-Za-z0-9._/-]{1,80}$/.test(policy.provider) || !/^[A-Za-z0-9._:/-]{1,200}$/.test(policy.model) ||
      policy.inputCostPer1kUsd === undefined || !Number.isFinite(policy.inputCostPer1kUsd) || policy.inputCostPer1kUsd <= 0) {
    throw new RerankerBudgetError("reranker_price_unavailable");
  }
  const costMicros = Math.max(1, Math.ceil(inputTokens / 1_000 * policy.inputCostPer1kUsd * 1_000_000));
  const maximum = policy.maxCostMicros ?? rerankerInputLimits.maxCostMicros;
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > 100_000_000 ||
      !Number.isSafeInteger(costMicros) || costMicros > maximum) {
    throw new RerankerBudgetError("reranker_cost_limit");
  }
  return {
    amount: { calls: 1, inputTokens, costMicros },
    identity: { provider: policy.provider, model: policy.model },
    inputTokens,
    costMicros,
  };
}
