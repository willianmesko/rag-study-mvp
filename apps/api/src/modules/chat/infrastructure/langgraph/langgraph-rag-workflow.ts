import { traceable } from "langsmith/traceable";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type {
  AnswerControls,
  AnswerGenerator,
  ProviderTokenUsage,
  ProviderUsageObserver,
} from "../../../ai/index.js";
import type {
  AnswerQuestionResult,
  AnswerWorkflowEvent,
  AnswerWorkflowInput,
  PreparedAnswerContext,
  PreparedAnswerWorkflow,
  QuestionAnsweringWorkflow,
} from "../../application/ports/question-answering-workflow.js";
import type { ClaimVerifier } from "../../../ai/index.js";
import {
  estimateGroundedPromptTokens,
  formatUntrustedContext,
  reserveGroundedPromptTokens,
  type GroundedContext,
} from "../../../ai/index.js";
import {
  assertStepBudget,
  withExecutionTimeout,
} from "../../../mcp/index.js";
import { ChatBudgetExceededError } from "../../../ai/index.js";
import { createConversationQuery } from "../../application/policies/conversation-context.js";
import {
  parseGroundedAnswer,
  validateGroundedAnswer,
} from "../../../ai/index.js";
import { rewriteRetrievalQuery } from "../../application/policies/retrieval-rewrite.js";
import { workflowNode } from "../../../../platform/workflows/execution-context.js";
import type { RetrievedChunk } from "../../../knowledge/index.js";
import { redactPii } from "../../../../platform/security/pii-redaction.js";
import { isSafeForAnswer } from "../../../../platform/security/prompt-injection.js";
import { graphExecution } from "../../../../platform/workflows/graph-execution.js";

type Retriever = {
  execute(input: {
    query: string;
    lexicalQuestion?: string;
    topK?: number;
    tenantId?: string;
    queryEmbedding?: number[];
    embeddingIndexVersion?: string;
    signal?: AbortSignal;
  }): Promise<RetrievedChunk[]>;
};
type Options = {
  maxContextChars: number;
  minimumScore: number;
  maxSteps?: number;
  timeoutMs?: number;
  requireStructuredOutput?: boolean;
  claimVerifier?: ClaimVerifier;
  claimVerifierFor?: (generator: AnswerGenerator) => ClaimVerifier;
  workflowId?: string;
};
const RetrievalState = Annotation.Root({
  question: Annotation<string>,
  previousQuestions: Annotation<readonly string[] | undefined>,
  topK: Annotation<number | undefined>,
  tenantId: Annotation<string | undefined>,
  queryEmbedding: Annotation<number[] | undefined>,
  embeddingIndexVersion: Annotation<string | undefined>,
  maxEstimatedInputTokens: Annotation<number | undefined>,
  matches: Annotation<RetrievedChunk[]>,
  rewrittenQuery: Annotation<string>,
  attempts: Annotation<number>,
  prepared: Annotation<PreparedAnswerContext | null>,
  steps: Annotation<number>({ reducer: (_, next) => next, default: () => 0 }),
});
const GenerationState = Annotation.Root({
  prepared: Annotation<PreparedAnswerContext>,
  raw: Annotation<string>,
  result: Annotation<AnswerQuestionResult>,
  repairCount: Annotation<number>,
  samples: Annotation<ProviderTokenUsage[]>,
  inputTokens: Annotation<number>,
  outputTokens: Annotation<number>,
  steps: Annotation<number>({ reducer: (_, next) => next, default: () => 0 }),
});
const insufficientContext: AnswerQuestionResult = {
  answer:
    "I could not find sufficiently relevant context in the indexed documents to answer safely.",
  sources: [],
  citedChunkIds: [],
  structuredOutput: true,
  refusalReason: "insufficient_context",
};

export class LangGraphRagWorkflow
  implements QuestionAnsweringWorkflow, PreparedAnswerWorkflow
{
  private readonly options: Options & {
    maxSteps: number;
    timeoutMs: number;
    requireStructuredOutput: boolean;
  };
  constructor(
    private readonly retriever: Retriever,
    private readonly answerGenerator: AnswerGenerator,
    options: Options,
  ) {
    this.options = {
      ...options,
      maxSteps: options.maxSteps ?? 12,
      timeoutMs: options.timeoutMs ?? 30_000,
      requireStructuredOutput: options.requireStructuredOutput ?? false,
    };
  }
  answer(input: AnswerWorkflowInput): Promise<AnswerQuestionResult> {
    return withExecutionTimeout(
      async (signal) => {
        const prepared = await this.prepare({ ...input, signal });
        return this.answerPrepared(prepared, this.answerGenerator, signal);
      },
      this.options.timeoutMs,
      input.signal,
    );
  }
  async prepare(
    input: AnswerWorkflowInput,
  ): Promise<PreparedAnswerContext | null> {
    const execution = graphExecution("rag-retrieve-v2");
    const graph = this.retrievalGraph().compile({
      checkpointer: execution?.saver,
    });
    const initial = {
      ...input,
      signal: undefined,
      matches: [],
      prepared: null,
      attempts: 0,
      steps: 0,
    };
    const value = execution
      ? await execution.input(initial, () => graph.getState(execution.config))
      : initial;
    const output = await traceable(() => graph.invoke(value, {
      ...execution?.config,
      signal: input.signal,
      recursionLimit: this.options.maxSteps + 4,
    }), { tracingEnabled: false })();
    input.signal?.throwIfAborted();
    return output.prepared;
  }
  answerPrepared(
    prepared: PreparedAnswerContext | null,
    generator: AnswerGenerator,
    signal?: AbortSignal,
    onUsage?: ProviderUsageObserver,
  ): Promise<AnswerQuestionResult> {
    return this.generate(prepared, generator, signal, onUsage, false);
  }
  answerStream(
    input: AnswerWorkflowInput,
    onEvent: (event: AnswerWorkflowEvent) => void | Promise<void>,
  ): Promise<AnswerQuestionResult> {
    return withExecutionTimeout(
      async (signal) => {
        const emit = async (event: AnswerWorkflowEvent) => {
          signal.throwIfAborted();
          await onEvent(event);
          signal.throwIfAborted();
        };
        await emit({ type: "retrieving" });
        const prepared = await this.prepare({ ...input, signal });
        if (!prepared) {
          await emit({ type: "validating" });
          return insufficientContext;
        }
        await emit({ type: "generating" });
        const result = await this.generate(
          prepared,
          this.answerGenerator,
          signal,
          undefined,
          true,
          () => emit({ type: "validating" }),
        );
        if (
          !result.refusalReason &&
          result.structuredOutput &&
          result.sources.length
        ) {
          await emit({ type: "citations", sources: result.sources });
          for (const delta of result.answer.match(/[\s\S]{1,256}/gu) ?? [])
            await emit({ type: "token", delta });
        }
        return result;
      },
      this.options.timeoutMs,
      input.signal,
    );
  }
  private retrievalGraph() {
    const retrieve = async (
      state: typeof RetrievalState.State,
      retry: boolean,
      signal?: AbortSignal,
    ) =>
      workflowNode(retry ? "retrieve_retry" : "retrieve", async () => {
        const steps = assertStepBudget(state.steps + 1, this.options);
        const matches = await this.retriever.execute({
          query: retry
            ? state.rewrittenQuery
            : createConversationQuery(state.question, state.previousQuestions),
          ...(retry
            ? { lexicalQuestion: state.rewrittenQuery }
            : state.previousQuestions?.length
              ? { lexicalQuestion: state.question }
              : {}),
          topK: state.topK,
          tenantId: state.tenantId,
          queryEmbedding: retry ? undefined : state.queryEmbedding,
          embeddingIndexVersion: state.embeddingIndexVersion,
          signal,
        });
        return {
          matches: matches.filter(
            (match) =>
              isSafeForAnswer(match.security) &&
              match.content.trim().length > 0,
          ),
          steps,
          attempts: retry ? 2 : 1,
        };
      });
    return new StateGraph(RetrievalState)
      .addNode("retrieve", (state, runtime) =>
        retrieve(state, false, runtime.signal),
      )
      .addNode("rewrite_query", (state) =>
        workflowNode("rewrite_query", async () => ({
          rewrittenQuery: rewriteRetrievalQuery(
            createConversationQuery(state.question, state.previousQuestions),
          ),
          steps: assertStepBudget(state.steps + 1, this.options),
        })),
      )
      .addNode("retrieve_retry", (state, runtime) =>
        retrieve(state, true, runtime.signal),
      )
      .addNode("prepare_context", (state) =>
        workflowNode("prepare_context", async () => {
          const steps = assertStepBudget(state.steps + 1, this.options);
          const context = formatUntrustedContext(
            state.matches,
            this.options.maxContextChars,
          );
          return {
            steps,
            prepared: this.hasRelevantSource(
              context.sourcesByReference.values(),
            )
              ? this.prepared(state, context)
              : null,
          };
        }),
      )
      .addNode("no_context", () => ({ prepared: null }))
      .addEdge(START, "retrieve")
      .addConditionalEdges("retrieve", (state) =>
        this.hasRelevantSource(state.matches)
          ? "prepare_context"
          : "rewrite_query",
      )
      .addEdge("rewrite_query", "retrieve_retry")
      .addConditionalEdges("retrieve_retry", (state) =>
        this.hasRelevantSource(state.matches)
          ? "prepare_context"
          : "no_context",
      )
      .addEdge("prepare_context", END)
      .addEdge("no_context", END);
  }
  private async generate(
    prepared: PreparedAnswerContext | null,
    generator: AnswerGenerator,
    signal?: AbortSignal,
    onUsage?: ProviderUsageObserver,
    stream = false,
    onValidating?: () => Promise<void>,
  ): Promise<AnswerQuestionResult> {
    if (!prepared) return insufficientContext;
    const verifier =
      this.options.claimVerifierFor?.(generator) ?? this.options.claimVerifier;
    const execution = graphExecution(
      `rag-generate-v2-${generator.checkpointKey ?? this.options.workflowId ?? "default"}`,
    );
    const produce = async (
      state: typeof GenerationState.State,
      repair: boolean,
    ) =>
      workflowNode(repair ? "repair_answer" : "generate_answer", async () => {
        const steps = assertStepBudget(state.steps + 1, this.options);
        const controls: AnswerControls = {
          extractive: verifier?.requiresExtractiveAnswer,
          ...(repair
            ? {
                repair: {
                  draft: state.raw,
                  reason:
                    state.result.refusalReason === "invalid_citations"
                      ? ("invalid_citations" as const)
                      : ("unverified_claims" as const),
                },
              }
            : {}),
        };
        const bound =
          reserveGroundedPromptTokens(
            prepared.question,
            prepared.context.text,
            prepared.previousQuestions,
          ) +
          (repair ? Buffer.byteLength(state.raw.slice(0, 5_000)) + 1_024 : 512);
        if (
          prepared.maxEstimatedInputTokens !== undefined &&
          state.inputTokens + bound > prepared.maxEstimatedInputTokens
        )
          throw new ChatBudgetExceededError();
        let observed: ProviderTokenUsage | undefined;
        const observe = (usage: ProviderTokenUsage) => {
          observed = usage;
        };
        const raw =
          stream && !repair && generator.stream
            ? await generator.stream(
                prepared.question,
                prepared.context.text,
                () => undefined,
                signal,
                observe,
                prepared.previousQuestions,
                controls,
              )
            : await generator.generate(
                prepared.question,
                prepared.context.text,
                signal,
                observe,
                prepared.previousQuestions,
                undefined,
                controls,
              );
        signal?.throwIfAborted();
        return {
          steps,
          raw,
          repairCount: repair ? 1 : 0,
          samples: observed ? [...state.samples, observed] : state.samples,
          inputTokens:
            state.inputTokens +
            estimateGroundedPromptTokens(
              prepared.question,
              prepared.context.text,
              prepared.previousQuestions,
            ) +
            (repair ? Math.ceil(state.raw.slice(0, 5_000).length / 4) : 0),
          outputTokens: state.outputTokens + Math.ceil(raw.length / 4),
        };
      });
    const validate = async (state: typeof GenerationState.State) =>
      workflowNode("verify_answer", async () => {
        const steps = assertStepBudget(state.steps + 1, this.options);
        const result = this.resolveAnswer(state.raw, prepared);
        if (!result.refusalReason && result.structuredOutput && verifier) {
          const verification = await verifier.verify(
            result.answer,
            result.sources,
            signal ?? AbortSignal.timeout(this.options.timeoutMs),
          );
          result.claimVerification = verification;
          if (!verification.supported) {
            result.answer =
              "I could not verify every claim against the retrieved passages, so I am declining to answer.";
            result.sources = [];
            result.citedChunkIds = [];
            result.refusalReason = "unverified_claims";
          }
        }
        return { steps, result };
      });
    const graph = new StateGraph(GenerationState)
      .addNode("generate_answer", (state) => produce(state, false))
      .addNode("verify_answer", validate)
      .addNode("repair_answer", (state) => produce(state, true))
      .addNode("verify_repair", validate)
      .addEdge(START, "generate_answer")
      .addEdge("generate_answer", "verify_answer")
      .addConditionalEdges("verify_answer", (state) =>
        state.repairCount === 0 &&
        ["invalid_citations", "unverified_claims"].includes(
          state.result.refusalReason ?? "",
        )
          ? "repair_answer"
          : END,
      )
      .addEdge("repair_answer", "verify_repair")
      .addEdge("verify_repair", END)
      .compile({ checkpointer: execution?.saver });
    const initial = {
      prepared,
      raw: "",
      repairCount: 0,
      samples: [],
      inputTokens: 0,
      outputTokens: 0,
      steps: prepared.retrievalAttempts === 2 ? 4 : 2,
    };
    const value = execution
      ? await execution.input(initial, () => graph.getState(execution.config))
      : initial;
    const output = await traceable(() => graph.invoke(value, {
      ...execution?.config,
      signal,
      recursionLimit: this.options.maxSteps + 4,
    }), { tracingEnabled: false })();
    signal?.throwIfAborted();
    await onValidating?.();
    const samples = output.samples;
    const providerUsage =
      samples.length === output.repairCount + 1
        ? samples.reduce<ProviderTokenUsage>(
            (total, sample) => ({
              inputTokens: total.inputTokens + sample.inputTokens,
              outputTokens: total.outputTokens + sample.outputTokens,
              ...(total.costUsd !== undefined && sample.costUsd !== undefined
                ? { costUsd: total.costUsd + sample.costUsd }
                : {}),
            }),
            { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          )
        : undefined;
    if (providerUsage) onUsage?.(providerUsage);
    return {
      ...output.result,
      estimatedInputTokens: output.inputTokens,
      estimatedOutputTokens: output.outputTokens,
      ...(providerUsage ? { providerUsage } : {}),
      repaired: output.repairCount === 1 && !output.result.refusalReason,
      retrievalAttempts: prepared.retrievalAttempts ?? 1,
    };
  }
  private hasRelevantSource(sources: Iterable<{ score: number }>) {
    for (const source of sources)
      if (source.score >= this.options.minimumScore) return true;
    return false;
  }
  private prepared(
    input: AnswerWorkflowInput & { attempts?: number },
    context: GroundedContext,
  ): PreparedAnswerContext {
    const { question, previousQuestions, maxEstimatedInputTokens } = input;
    const estimatedInputTokens = estimateGroundedPromptTokens(
      question,
      context.text,
      previousQuestions,
    );
    if (
      maxEstimatedInputTokens !== undefined &&
      reserveGroundedPromptTokens(question, context.text, previousQuestions) >
        maxEstimatedInputTokens
    )
      throw new ChatBudgetExceededError();
    return {
      question,
      ...(previousQuestions?.length ? { previousQuestions } : {}),
      context,
      estimatedInputTokens,
      maxEstimatedInputTokens,
      retrievalAttempts: input.attempts ?? 1,
    };
  }
  private resolveAnswer(
    rawAnswer: string,
    { context, estimatedInputTokens, previousQuestions }: PreparedAnswerContext,
  ): AnswerQuestionResult {
    const parsed = validateGroundedAnswer(
      parseGroundedAnswer(rawAnswer),
      new Set(context.sourcesByReference.keys()),
    );
    if (
      (this.options.requireStructuredOutput ||
        this.options.claimVerifier ||
        previousQuestions?.length) &&
      !parsed.structured
    )
      return {
        answer:
          "I could not validate the model's structured response, so I am declining to answer.",
        sources: [],
        citedChunkIds: [],
        structuredOutput: false,
        refusalReason: "unstructured_model_output",
      };
    if (parsed.refusalReason)
      return {
        answer: redactPii(parsed.answer).text,
        sources: [],
        citedChunkIds: [],
        structuredOutput: parsed.structured,
        refusalReason: redactPii(parsed.refusalReason).text,
      };
    const contextSources = [...context.sourcesByReference.values()];
    const sources = parsed.structured
      ? [...new Set(parsed.citedChunkIds)].flatMap(
          (reference) => context.sourcesByReference.get(reference) ?? [],
        )
      : contextSources;
    return {
      answer: redactPii(parsed.answer).text,
      sources,
      contextSources,
      citedChunkIds: parsed.structured
        ? sources.map((source) => source.chunkId)
        : [],
      structuredOutput: parsed.structured,
      estimatedInputTokens,
    };
  }
}
