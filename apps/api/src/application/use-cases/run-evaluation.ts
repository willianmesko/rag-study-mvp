import { evaluateContextPrecision, reviewedPassageVersion } from "../evaluation/context-precision.js";
import { evaluationOutputLimits, type EvaluationEffort } from "../evaluation/evaluation-effort.js";
import { evaluateRetrieval } from "../evaluation/golden-set.js";
import { evaluatePromptInjectionSuite } from "../evaluation/prompt-injection-suite.js";
import { dashboardGoldenSet, dashboardPromptInjectionSuite } from "../evaluation/default-evaluation-suites.js";
import { evaluatePublicFaithfulness, faithfulnessBenchmarkVersion, unavailableFaithfulness, type EvaluationModel, type FaithfulnessJudge } from "../evaluation/public-faithfulness.js";
import type { EvaluationRepository } from "../ports/evaluation-repository.js";
import type { SearchDocumentsUseCase } from "./search-documents.js";

type EmbeddingIdentity = { provider: string; model: string; version?: string };

export class EvaluationRunError extends Error {
  constructor(readonly code: "evaluation_in_progress" | "judge_unavailable" | "model_unavailable" | "evaluation_reference_missing") {
    super({
      evaluation_in_progress: "An evaluation is already running in this workspace.",
      judge_unavailable: "Faithfulness evaluation is not enabled.",
      model_unavailable: "Select an available evaluation model.",
      evaluation_reference_missing: "Add and prepare the RAG reference benchmark document before running this evaluation."
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
    private readonly faithfulness?: {
      judge: FaithfulnessJudge;
      resolveModel: (tenantId: string, modelId: string | undefined, maxOutputTokens: number) => EvaluationModel | undefined | Promise<EvaluationModel | undefined>;
    },
    private readonly embeddingIdentity?: (tenantId: string) => Promise<EmbeddingIdentity | undefined>,
    private readonly referenceReady?: (tenantId: string) => Promise<boolean>
  ) {}

  get supportsFaithfulness() { return Boolean(this.faithfulness); }

  async execute(input: { tenantId: string; includeFaithfulness?: boolean; modelId?: string; effort?: EvaluationEffort }) {
    const faithfulness = this.faithfulness;
    const effort = input.effort ?? "standard";
    if (input.includeFaithfulness && !faithfulness) throw new EvaluationRunError("judge_unavailable");
    if (this.activeTenants.has(input.tenantId)) throw new EvaluationRunError("evaluation_in_progress");
    this.activeTenants.add(input.tenantId);

    try {
      if (this.referenceReady && !await this.referenceReady(input.tenantId)) throw new EvaluationRunError("evaluation_reference_missing");
      const model = input.includeFaithfulness ? await faithfulness?.resolveModel(input.tenantId, input.modelId, evaluationOutputLimits[effort]) : undefined;
      if (input.includeFaithfulness && !model) throw new EvaluationRunError("model_unavailable");
      return await this.run(input.tenantId, effort, model, faithfulness?.judge);
    } finally {
      this.activeTenants.delete(input.tenantId);
    }
  }

  private async retrieveReferenceCases(tenantId: string) {
    const index = await this.embeddingIdentity?.(tenantId);
    const signal = AbortSignal.timeout(16_000);
    const outcomes = await Promise.allSettled(dashboardGoldenSet.cases.map(async (item) => this.searchDocuments.execute({ query: item.question, tenantId, signal })));
    const resultsByCaseId = new Map<string, Awaited<ReturnType<SearchDocumentsUseCase["execute"]>>>();
    const retrievalErrors: Array<{ id: string; code: "retrieval_failed" | "embedding_index_changed" }> = [];
    const current = await this.embeddingIdentity?.(tenantId);
    const changed = index?.version !== current?.version || index?.provider !== current?.provider || index?.model !== current?.model;
    for (const [caseIndex, outcome] of outcomes.entries()) {
      const id = dashboardGoldenSet.cases[caseIndex]!.id;
      if (changed) retrievalErrors.push({ id, code: "embedding_index_changed" });
      else if (outcome.status === "fulfilled") resultsByCaseId.set(id, outcome.value);
      else retrievalErrors.push({ id, code: "retrieval_failed" });
    }
    return { resultsByCaseId, retrievalErrors, index };
  }

  private async run(tenantId: string, effort: EvaluationEffort, model?: EvaluationModel, judge?: FaithfulnessJudge) {
    const startedAt = Date.now();
    const [{ resultsByCaseId, retrievalErrors, index }, faithfulness] = await Promise.all([
      this.retrieveReferenceCases(tenantId),
      model && judge ? evaluatePublicFaithfulness(model, judge, effort) : unavailableFaithfulness(judge ? "not_requested" : "unavailable", judge?.model ?? null)
    ]);
    const { value: faithfulnessValue, ...faithfulnessDetails } = faithfulness;

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
      ...(index ? { embeddingProvider: index.provider, embeddingModel: index.model } : {}),
      ...(model ? { chatProvider: model.provider, chatModel: model.model } : {}),
      totalCases: dashboardGoldenSet.cases.length,
      hitRate: retrieval.hitRate,
      meanReciprocalRank: retrieval.meanReciprocalRank,
      faithfulness: faithfulnessValue,
      contextPrecision: contextPrecision.value,
      injectionPassRate,
      passed: retrieval.passed && injection.passed && retrievalErrors.length === 0,
      durationMs: Date.now() - startedAt,
      failureDetails: {
        retrieval: retrieval.failedCases.map(({ id }) => ({ id })),
        retrievalErrors,
        injection: injection.failures,
        quality: {
          contextPrecision: { method: "reviewed-passage-ap", version: reviewedPassageVersion, scoredCases: contextPrecision.scoredCases,
            ...(index?.version ? { embeddingIndexVersion: index.version } : {}) },
          faithfulness: {
            method: "public-claim-evidence-judge", version: faithfulnessBenchmarkVersion, ...faithfulnessDetails
          }
        }
      }
    });
  }
}
