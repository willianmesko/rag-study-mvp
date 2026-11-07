import { evaluateContextPrecision, reviewedPassageVersion } from "../evaluation/context-precision.js";
import { evaluateRetrieval } from "../evaluation/golden-set.js";
import { evaluatePromptInjectionSuite } from "../evaluation/prompt-injection-suite.js";
import { dashboardGoldenSet, dashboardPromptInjectionSuite } from "../evaluation/default-evaluation-suites.js";
import { evaluatePublicFaithfulness, faithfulnessBenchmarkVersion, unavailableFaithfulness, type EvaluationModel, type FaithfulnessJudge } from "../evaluation/public-faithfulness.js";
import type { EvaluationRepository } from "../ports/evaluation-repository.js";
import type { SearchDocumentsUseCase } from "./search-documents.js";

export class EvaluationRunError extends Error {
  constructor(readonly code: "evaluation_in_progress" | "judge_unavailable" | "model_unavailable") {
    super({
      evaluation_in_progress: "An evaluation is already running in this workspace.",
      judge_unavailable: "Faithfulness evaluation is not enabled.",
      model_unavailable: "Select an available evaluation model."
    }[code]);
    this.name = "EvaluationRunError";
  }
}

export class RunEvaluationUseCase {
  private readonly activeTenants = new Set<string>();

  constructor(
    private readonly searchDocuments: Pick<SearchDocumentsUseCase, "execute">,
    private readonly evaluations: EvaluationRepository,
    private readonly models: { embeddingProvider: string; embeddingModel: string; chatProvider: string; chatModel: string },
    private readonly faithfulness?: { judge: FaithfulnessJudge; resolveModel: (modelId?: string) => EvaluationModel | undefined }
  ) {}

  get supportsFaithfulness() { return Boolean(this.faithfulness); }

  async execute(input: { tenantId: string; includeFaithfulness?: boolean; modelId?: string }) {
    const faithfulness = this.faithfulness;
    const model = input.includeFaithfulness ? faithfulness?.resolveModel(input.modelId) : undefined;
    if (input.includeFaithfulness && !faithfulness) throw new EvaluationRunError("judge_unavailable");
    if (input.includeFaithfulness && !model) throw new EvaluationRunError("model_unavailable");
    if (this.activeTenants.has(input.tenantId)) throw new EvaluationRunError("evaluation_in_progress");
    this.activeTenants.add(input.tenantId);

    try {
      return await this.run(input.tenantId, model, faithfulness?.judge);
    } finally {
      this.activeTenants.delete(input.tenantId);
    }
  }

  private async retrieveReferenceCases(tenantId: string) {
    const signal = AbortSignal.timeout(16_000);
    const outcomes = await Promise.allSettled(dashboardGoldenSet.cases.map(async (item) => this.searchDocuments.execute({ query: item.question, tenantId, signal })));
    const resultsByCaseId = new Map<string, Awaited<ReturnType<SearchDocumentsUseCase["execute"]>>>();
    const retrievalErrors: Array<{ id: string; code: "retrieval_failed" }> = [];
    for (const [index, outcome] of outcomes.entries()) {
      const id = dashboardGoldenSet.cases[index]!.id;
      if (outcome.status === "fulfilled") resultsByCaseId.set(id, outcome.value);
      else retrievalErrors.push({ id, code: "retrieval_failed" });
    }
    return { resultsByCaseId, retrievalErrors };
  }

  private async run(tenantId: string, model?: EvaluationModel, judge?: FaithfulnessJudge) {
    const startedAt = Date.now();
    const [{ resultsByCaseId, retrievalErrors }, faithfulness] = await Promise.all([
      this.retrieveReferenceCases(tenantId),
      model && judge ? evaluatePublicFaithfulness(model, judge) : unavailableFaithfulness(judge ? "not_requested" : "unavailable", judge?.model ?? null)
    ]);

    const retrieval = evaluateRetrieval(dashboardGoldenSet, resultsByCaseId);
    const contextPrecision = evaluateContextPrecision(dashboardGoldenSet, resultsByCaseId);
    const injection = evaluatePromptInjectionSuite(dashboardPromptInjectionSuite);
    const injectionPassRate = (injection.total - injection.failures.length) / injection.total;
    return this.evaluations.create({
      tenantId,
      datasetName: dashboardGoldenSet.name,
      datasetVersion: dashboardGoldenSet.version,
      commitSha: process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? null,
      ...this.models,
      ...(model ? { chatProvider: model.provider, chatModel: model.model } : {}),
      totalCases: dashboardGoldenSet.cases.length,
      hitRate: retrieval.hitRate,
      meanReciprocalRank: retrieval.meanReciprocalRank,
      faithfulness: faithfulness.value,
      contextPrecision: contextPrecision.value,
      injectionPassRate,
      passed: retrieval.passed && injection.passed && retrievalErrors.length === 0,
      durationMs: Date.now() - startedAt,
      failureDetails: {
        retrieval: retrieval.failedCases.map(({ id }) => ({ id })),
        retrievalErrors,
        injection: injection.failures,
        quality: {
          contextPrecision: { method: "reviewed-passage-ap", version: reviewedPassageVersion, scoredCases: contextPrecision.scoredCases },
          faithfulness: {
            method: "public-claim-evidence-judge", version: faithfulnessBenchmarkVersion, status: faithfulness.status,
            judgeModel: faithfulness.judgeModel, scoredCases: faithfulness.scoredCases, totalCases: faithfulness.totalCases
          }
        }
      }
    });
  }
}
