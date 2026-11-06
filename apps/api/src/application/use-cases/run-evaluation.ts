import { evaluateRetrieval } from "../evaluation/golden-set.js";
import { evaluatePromptInjectionSuite } from "../evaluation/prompt-injection-suite.js";
import { dashboardGoldenSet, dashboardPromptInjectionSuite } from "../evaluation/default-evaluation-suites.js";
import type { EvaluationRepository } from "../ports/evaluation-repository.js";
import type { SearchDocumentsUseCase } from "./search-documents.js";

export class RunEvaluationUseCase {
  constructor(
    private readonly searchDocuments: SearchDocumentsUseCase,
    private readonly evaluations: EvaluationRepository,
    private readonly models: { embeddingProvider: string; embeddingModel: string; chatProvider: string; chatModel: string }
  ) {}

  async execute(input: { tenantId: string }) {
    const startedAt = Date.now();
    const resultsByCaseId = new Map<string, Awaited<ReturnType<SearchDocumentsUseCase["execute"]>>>();
    const retrievalErrors: Array<{ id: string; message: string }> = [];

    for (const item of dashboardGoldenSet.cases) {
      try {
        resultsByCaseId.set(item.id, await this.searchDocuments.execute({ query: item.question, tenantId: input.tenantId }));
      } catch (error) {
        retrievalErrors.push({ id: item.id, message: error instanceof Error ? error.message.slice(0, 240) : "Retrieval failed." });
        resultsByCaseId.set(item.id, []);
      }
    }

    const retrieval = evaluateRetrieval(dashboardGoldenSet, resultsByCaseId);
    const injection = evaluatePromptInjectionSuite(dashboardPromptInjectionSuite);
    const injectionPassRate = (injection.total - injection.failures.length) / injection.total;
    const run = await this.evaluations.create({
      tenantId: input.tenantId,
      datasetName: dashboardGoldenSet.name,
      datasetVersion: dashboardGoldenSet.version,
      commitSha: process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? null,
      ...this.models,
      totalCases: dashboardGoldenSet.cases.length,
      hitRate: retrieval.hitRate,
      meanReciprocalRank: retrieval.meanReciprocalRank,
      faithfulness: null,
      contextPrecision: null,
      injectionPassRate,
      passed: retrieval.passed && injection.passed && retrievalErrors.length === 0,
      durationMs: Date.now() - startedAt,
      failureDetails: {
        retrieval: retrieval.failedCases.map(({ id, returnedSources }) => ({ id, returnedSources })),
        retrievalErrors,
        injection: injection.failures
      }
    });
    return run;
  }
}
