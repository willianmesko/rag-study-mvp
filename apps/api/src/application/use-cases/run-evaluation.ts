import {withProviderUsageScope,currentProviderUsageScope} from '../provider-usage-context.js';
import { retrieveReferenceCases as retrieveCases } from "../evaluation/retrieve-reference-cases.js";
import { assembleEvaluationReport } from "../evaluation/assemble-report.js";
import { evaluateContextPrecision } from "../evaluation/context-precision.js";
import { evaluationOutputLimits, type EvaluationEffort } from "../evaluation/evaluation-effort.js";
import { evaluateRetrieval } from "../evaluation/golden-set.js";
import { evaluatePromptInjectionSuite } from "../evaluation/prompt-injection-suite.js";
import { dashboardGoldenSet, dashboardPromptInjectionSuite } from "../evaluation/default-evaluation-suites.js";
import { evaluatePublicFaithfulness, unavailableFaithfulness, type EvaluationModel, type FaithfulnessJudge } from "../evaluation/public-faithfulness.js";
import type { EvaluationRepository } from "../ports/evaluation-repository.js";
import type { SearchDocumentsUseCase } from "./search-documents.js";
import type { EvaluationWorkflow } from "../ports/evaluation-workflow.js";

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
    private readonly referenceReady?: (tenantId: string) => Promise<boolean>,
    private readonly workflow?:EvaluationWorkflow
  ) {}

  get supportsFaithfulness() { return Boolean(this.faithfulness); }

  async preflight(input: {tenantId:string;includeFaithfulness?:boolean;modelId?:string;effort?:EvaluationEffort}) {
    if (input.includeFaithfulness && !this.faithfulness) throw new EvaluationRunError('judge_unavailable');
    if (this.referenceReady && !await this.referenceReady(input.tenantId)) throw new EvaluationRunError('evaluation_reference_missing');
    if (input.includeFaithfulness && !await this.faithfulness?.resolveModel(input.tenantId,input.modelId,evaluationOutputLimits[input.effort ?? 'standard'])) throw new EvaluationRunError('model_unavailable');
  }
  async execute(input: { tenantId: string; includeFaithfulness?: boolean; modelId?: string; effort?: EvaluationEffort;signal?:AbortSignal }) {
    return withProviderUsageScope({tenantId:input.tenantId,actorKey:currentProviderUsageScope()?.actorKey??'system:evaluation',purpose:'evaluation'},()=>this.executeScoped(input));
  }
  private async executeScoped(input: { tenantId: string; includeFaithfulness?: boolean; modelId?: string; effort?: EvaluationEffort;signal?:AbortSignal }) {
    const faithfulness = this.faithfulness;
    const effort = input.effort ?? "standard";
    if (input.includeFaithfulness && !faithfulness) throw new EvaluationRunError("judge_unavailable");
    if (this.activeTenants.has(input.tenantId)) throw new EvaluationRunError("evaluation_in_progress");
    this.activeTenants.add(input.tenantId);

    try {
      if (this.referenceReady && !await this.referenceReady(input.tenantId)) throw new EvaluationRunError("evaluation_reference_missing");
      const model = input.includeFaithfulness ? await faithfulness?.resolveModel(input.tenantId, input.modelId, evaluationOutputLimits[effort]) : undefined;
      if (input.includeFaithfulness && !model) throw new EvaluationRunError("model_unavailable");
      if(this.workflow)return await this.workflow.execute({tenantId:input.tenantId,effort,model,judge:faithfulness?.judge,signal:input.signal});
      return await this.run(input.tenantId, effort, model, faithfulness?.judge);
    } finally {
      this.activeTenants.delete(input.tenantId);
    }
  }

  private async retrieveReferenceCases(tenantId:string) {
    return retrieveCases(this.searchDocuments,tenantId,this.embeddingIdentity,AbortSignal.timeout(16_000));
  }

  private async run(tenantId: string, effort: EvaluationEffort, model?: EvaluationModel, judge?: FaithfulnessJudge) {
    const startedAt = Date.now();
    const [{ resultsByCaseId, retrievalErrors, index }, faithfulness] = await Promise.all([
      this.retrieveReferenceCases(tenantId),
      model && judge ? evaluatePublicFaithfulness(model, judge, effort) : unavailableFaithfulness(judge ? "not_requested" : "unavailable", judge?.model ?? null)
    ]);

    const retrieval = evaluateRetrieval(dashboardGoldenSet, resultsByCaseId);
    const contextPrecision = evaluateContextPrecision(dashboardGoldenSet, resultsByCaseId);
    const injection = evaluatePromptInjectionSuite(dashboardPromptInjectionSuite);
    return this.evaluations.create(assembleEvaluationReport({tenantId,identity:{...this.models,...(model?{chatProvider:model.provider,chatModel:model.model}:{})},
      cases:{resultsByCaseId,retrievalErrors,index},faithfulness,metrics:{retrieval,contextPrecision,injection},durationMs:Date.now()-startedAt}));
  }
}
