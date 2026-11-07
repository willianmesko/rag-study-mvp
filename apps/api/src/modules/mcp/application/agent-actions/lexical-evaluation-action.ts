import { evaluateContextPrecision, reviewedPassageVersion } from "../../../evaluations/index.js";
import { dashboardGoldenSet, dashboardPromptInjectionSuite } from "../../../evaluations/index.js";
import { evaluateRetrieval } from "../../../evaluations/index.js";
import { evaluatePromptInjectionSuite } from "../../../evaluations/index.js";
import { toLexicalQuery } from "../../../knowledge/index.js";
import type { RetrievedChunk } from "../../../knowledge/index.js";
import { isSafeForAnswer } from "../../../../platform/security/prompt-injection.js";
import type { AgentActionHandler } from "./agent-action-worker.js";

type LexicalReader = {
  search(tenantId: string, lexicalQuery: string, limit: number, signal: AbortSignal): Promise<RetrievedChunk[]>;
};

export class LexicalEvaluationAction implements AgentActionHandler {
  constructor(private readonly reader: LexicalReader) {}

  async prepare(tenantId: string, signal: AbortSignal) {
    const startedAt = Date.now();
    const results = new Map<string, RetrievedChunk[]>();
    // A fixed four-case suite, up to five matches per case, with no provider
    // or filesystem access. Sequential reads share one attempt deadline.
    for (const item of dashboardGoldenSet.cases) {
      signal.throwIfAborted();
      const matches = await this.reader.search(tenantId, toLexicalQuery(item.question), 5, signal);
      results.set(item.id, matches.filter((match) => isSafeForAnswer(match.security)));
    }
    signal.throwIfAborted();
    const retrieval = evaluateRetrieval(dashboardGoldenSet, results);
    const contextPrecision = evaluateContextPrecision(dashboardGoldenSet, results);
    const injection = evaluatePromptInjectionSuite(dashboardPromptInjectionSuite);

    return {
      tenantId,
      datasetName: `${dashboardGoldenSet.name} (lexical action)`,
      datasetVersion: dashboardGoldenSet.version,
      commitSha: null,
      embeddingProvider: "none",
      embeddingModel: "none",
      chatProvider: "none",
      chatModel: "none",
      totalCases: retrieval.total,
      hitRate: retrieval.hitRate,
      meanReciprocalRank: retrieval.meanReciprocalRank,
      faithfulness: null,
      contextPrecision: contextPrecision.value,
      injectionPassRate: (injection.total - injection.failures.length) / injection.total,
      passed: retrieval.passed && injection.passed,
      durationMs: Date.now() - startedAt,
      failureDetails: {
        retrieval: retrieval.failedCases.map(({ id }) => ({ id })),
        injection: injection.failures.map(({ id }) => ({ id })),
        quality: {
          retrievalMethod: "postgres-lexical",
          contextPrecision: { method: "reviewed-passage-ap", version: reviewedPassageVersion, scoredCases: contextPrecision.scoredCases }
        }
      }
    };
  }
}
