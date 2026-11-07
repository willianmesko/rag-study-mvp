import {
  Annotation,
  END,
  START,
  StateGraph,
  interrupt,
} from "@langchain/langgraph";
import type { EvaluationWorkflow } from "../../application/ports/evaluation-workflow.js";
import type {
  EvaluationRepository,
  EvaluationRun,
} from "../../application/ports/evaluation-repository.js";
import type { SearchDocumentsUseCase } from "../../../knowledge/index.js";
import {
  calibrate,
  generatePublicCase,
  scoreGeneratedPublicCase,
  publicFaithfulnessReport,
  unavailableFaithfulness,
  type CalibrationReport,
  type FaithfulnessResult,
  type PublicGeneratedCase,
} from "../../application/evaluation/public-faithfulness.js";
import {
  dashboardGoldenSet,
  dashboardPromptInjectionSuite,
} from "../../application/evaluation/default-evaluation-suites.js";
import { evaluateRetrieval } from "../../application/evaluation/golden-set.js";
import { evaluateContextPrecision } from "../../application/evaluation/context-precision.js";
import { evaluatePromptInjectionSuite } from "../../application/evaluation/prompt-injection-suite.js";
import {
  assembleEvaluationReport,
  type EvaluationMetrics,
} from "../../application/evaluation/assemble-report.js";
import {
  retrieveReferenceCases,
  type EvaluationEmbeddingIdentity,
  type ReferenceRetrieval,
} from "../../application/evaluation/retrieve-reference-cases.js";
import {
  currentExecution,
  workflowNode,
} from "../../../../platform/workflows/execution-context.js";
import {
  WorkflowApprovalPending,
  WorkflowGuardError,
} from "../../../../platform/workflows/types.js";
import { graphExecution } from "../../../../platform/workflows/graph-execution.js";

export const evaluationWorkflowVersion = "evaluation-v2";
const State = Annotation.Root({
  tenantId: Annotation<string>,
  startedAt: Annotation<number>,
  cases: Annotation<ReferenceRetrieval>,
  calibration: Annotation<CalibrationReport>,
  generated: Annotation<PublicGeneratedCase[]>,
  faithfulness: Annotation<FaithfulnessResult>,
  retrieval: Annotation<EvaluationMetrics["retrieval"]>,
  contextPrecision: Annotation<EvaluationMetrics["contextPrecision"]>,
  injection: Annotation<EvaluationMetrics["injection"]>,
  result: Annotation<EvaluationRun>,
});

export class LangGraphEvaluationWorkflow implements EvaluationWorkflow {
  constructor(
    private readonly search: Pick<SearchDocumentsUseCase, "execute">,
    private readonly evaluations: EvaluationRepository,
    private readonly identity: {
      embeddingProvider: string;
      embeddingModel: string;
      chatProvider: string;
      chatModel: string;
    },
    private readonly embeddingIdentity?: (
      tenantId: string,
    ) => Promise<EvaluationEmbeddingIdentity | undefined>,
  ) {}
  async execute(
    input: Parameters<EvaluationWorkflow["execute"]>[0],
  ): Promise<EvaluationRun> {
    const { tenantId, model, judge, effort } = input;
    const signal =
      input.signal ??
      currentExecution()?.signal ??
      AbortSignal.timeout(120_000);
    const execution = graphExecution(evaluationWorkflowVersion);
    if (model && judge && !execution) throw new WorkflowApprovalPending();
    const builder = new StateGraph(State)
      .addNode("approval", () =>
        workflowNode("approval", async () => {
          if (model && judge) {
            const choice = interrupt<unknown, { approved: boolean }>({
              action: "run_evaluation",
              provider: model.provider,
              model: model.model,
              judge: judge.model,
              maxOutputTokens: model.maxOutputTokens,
            });
            if (!choice.approved || !currentExecution()?.lease.approvedBy)
              throw new WorkflowGuardError("authorization_revoked");
          }
          return {};
        }),
      )
      .addNode("retrieve_cases", () =>
        workflowNode("retrieve_cases", async () => ({
          cases: await retrieveReferenceCases(
            this.search,
            tenantId,
            this.embeddingIdentity,
            signal,
          ),
        })),
      )
      .addNode("retrieval_metrics", (state) =>
        workflowNode("retrieval_metrics", async () => ({
          retrieval: evaluateRetrieval(
            dashboardGoldenSet,
            state.cases.resultsByCaseId,
          ),
        })),
      )
      .addNode("calibrate", () =>
        workflowNode("calibrate", async () => ({
          calibration: await calibrate(judge!, signal),
        })),
      )
      .addNode("generate_answers", () =>
        workflowNode("generate_answers", async () => {
          const generated: PublicGeneratedCase[] = [];
          for (
            let start = 0;
            start < dashboardGoldenSet.cases.length;
            start += 2
          ) {
            signal.throwIfAborted();
            generated.push(
              ...(await Promise.all(
                dashboardGoldenSet.cases
                  .slice(start, start + 2)
                  .map((item) => generatePublicCase(item, model!, signal)),
              )),
            );
          }
          return { generated };
        }),
      )
      .addNode("score_faithfulness", (state) =>
        workflowNode("score_faithfulness", async () => {
          const measurements = await Promise.all(
            (state.generated ?? []).map((generated) =>
              scoreGeneratedPublicCase(generated, judge!, signal),
            ),
          );
          return {
            faithfulness: publicFaithfulnessReport(
              model!,
              judge!,
              effort,
              state.calibration,
              measurements,
            ),
          };
        }),
      )
      .addNode("skip_faithfulness", (state) => ({
        faithfulness:
          model && judge
            ? publicFaithfulnessReport(
                model,
                judge,
                effort,
                state.calibration,
                [],
              )
            : unavailableFaithfulness(
                judge ? "not_requested" : "unavailable",
                judge?.model ?? null,
              ),
      }))
      .addNode("context_precision", (state) =>
        workflowNode("context_precision", async () => ({
          contextPrecision: evaluateContextPrecision(
            dashboardGoldenSet,
            state.cases.resultsByCaseId,
          ),
        })),
      )
      .addNode("security", () =>
        workflowNode("security", async () => ({
          injection: evaluatePromptInjectionSuite(
            dashboardPromptInjectionSuite,
          ),
        })),
      )
      .addNode("report", (state) =>
        workflowNode("evaluation_report", async () => {
          const current = currentExecution(),
            snapshot = current
              ? await current.repository.get(current.lease)
              : undefined;
          const report = assembleEvaluationReport({
            tenantId,
            identity: {
              ...this.identity,
              ...(model
                ? { chatProvider: model.provider, chatModel: model.model }
                : {}),
            },
            cases: state.cases,
            faithfulness: state.faithfulness,
            metrics: {
              retrieval: state.retrieval,
              contextPrecision: state.contextPrecision,
              injection: state.injection,
            },
            durationMs: Math.max(0, Date.now() - state.startedAt),
            ...(snapshot
              ? {
                  workflow: {
                    version: evaluationWorkflowVersion,
                    runId: snapshot.runId,
                    costMicros: snapshot.costMicros,
                    calls: snapshot.calls,
                  },
                }
              : {}),
          });
          return { result: await this.evaluations.create(report) };
        }),
      )
      .addEdge(START, "approval")
      .addEdge("approval", "retrieve_cases")
      .addEdge("retrieve_cases", "retrieval_metrics")
      .addConditionalEdges("retrieval_metrics", () =>
        model && judge ? "calibrate" : "skip_faithfulness",
      )
      .addConditionalEdges("calibrate", (state) =>
        state.calibration.agreement === 1 &&
        state.calibration.scoredExamples === state.calibration.totalExamples
          ? "generate_answers"
          : "skip_faithfulness",
      )
      .addEdge("generate_answers", "score_faithfulness")
      .addEdge("score_faithfulness", "context_precision")
      .addEdge("skip_faithfulness", "context_precision")
      .addEdge("context_precision", "security")
      .addEdge("security", "report")
      .addEdge("report", END);
    const graph = builder.compile({ checkpointer: execution?.saver });
    const initial = { tenantId, startedAt: Date.now() };
    const value = execution
      ? await execution.input(initial, () => graph.getState(execution.config))
      : initial;
    const output = await graph.invoke(value, {
      ...execution?.config,
      signal,
      recursionLimit: 50,
    });
    if (!output.result) throw new WorkflowApprovalPending();
    return output.result;
  }
}
