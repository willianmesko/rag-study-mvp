import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { AnswerGenerator } from "../../application/ports/answer-generator.js";
import type { AnswerQuestionResult, AnswerWorkflowEvent, AnswerWorkflowInput, QuestionAnsweringWorkflow } from "../../application/ports/question-answering-workflow.js";
import { formatUntrustedContext, type GroundedContext } from "../../application/policies/grounded-answer-policy.js";
import { assertStepBudget, withExecutionTimeout } from "../../application/policies/agent-execution-policy.js";
import { parseGroundedAnswer, validateGroundedAnswer } from "../../application/policies/structured-answer.js";
import type { RetrievedChunk } from "../../domain/document.js";
import { redactPii } from "../../domain/security/pii-redaction.js";
import { isSafeForAnswer } from "../../domain/security/prompt-injection.js";

type Retriever = {
  execute(input: { query: string; topK?: number; tenantId?: string; queryEmbedding?: number[]; signal?: AbortSignal }): Promise<RetrievedChunk[]>;
};

const RagState = Annotation.Root({
  question: Annotation<string>,
  topK: Annotation<number | undefined>,
  tenantId: Annotation<string | undefined>,
  queryEmbedding: Annotation<number[] | undefined>,
  matches: Annotation<RetrievedChunk[]>(),
  context: Annotation<GroundedContext>(),
  result: Annotation<AnswerQuestionResult>(),
  stepCount: Annotation<number>({ reducer: (_previous, next) => next, default: () => 0 })
});

const insufficientContext: AnswerQuestionResult = {
  answer: "I could not find sufficiently relevant context in the indexed documents to answer safely.",
  sources: [],
  citedChunkIds: [],
  structuredOutput: true,
  refusalReason: "insufficient_context"
};

export class LangGraphRagWorkflow implements QuestionAnsweringWorkflow {
  private readonly graph;
  private readonly options: { maxContextChars: number; minimumScore: number; maxSteps: number; timeoutMs: number; requireStructuredOutput: boolean };

  constructor(
    private readonly retriever: Retriever,
    private readonly answerGenerator: AnswerGenerator,
    options: { maxContextChars: number; minimumScore: number; maxSteps?: number; timeoutMs?: number; requireStructuredOutput?: boolean }
  ) {
    this.options = {
      maxContextChars: options.maxContextChars,
      minimumScore: options.minimumScore,
      maxSteps: options.maxSteps ?? 8,
      timeoutMs: options.timeoutMs ?? 30_000,
      requireStructuredOutput: options.requireStructuredOutput ?? false
    };
    this.graph = this.createGraph();
  }

  async answer({ signal, ...input }: AnswerWorkflowInput): Promise<AnswerQuestionResult> {
    const output = await withExecutionTimeout((executionSignal) => this.graph.invoke(input, { signal: executionSignal }), this.options.timeoutMs, signal);
    return output.result;
  }

  answerStream(input: AnswerWorkflowInput, onEvent: (event: AnswerWorkflowEvent) => void | Promise<void>): Promise<AnswerQuestionResult> {
    return withExecutionTimeout(async (signal) => {
      const emit = async (event: AnswerWorkflowEvent) => {
        signal.throwIfAborted();
        await onEvent(event);
        signal.throwIfAborted();
      };
      await emit({ type: "retrieving" });
      const matches = await this.retriever.execute({
        query: input.question, topK: input.topK, tenantId: input.tenantId, queryEmbedding: input.queryEmbedding, signal
      });
      signal.throwIfAborted();
      const context = formatUntrustedContext(matches.filter((match) => isSafeForAnswer(match.security)), this.options.maxContextChars);
      if (!this.hasRelevantSource(context.sourcesByReference.values())) {
        await emit({ type: "validating" });
        return insufficientContext;
      }
      await emit({ type: "generating" });
      const rawAnswer = this.answerGenerator.stream
        ? await this.answerGenerator.stream(input.question, context.text, () => undefined, signal)
        : await this.answerGenerator.generate(input.question, context.text, signal);
      await emit({ type: "validating" });
      const result = this.resolveAnswer(rawAnswer, context);
      // Only publish deltas after the structured answer and its source references are checked.
      if (!result.refusalReason && result.structuredOutput && result.sources.length > 0) {
        await emit({ type: "citations", sources: result.sources });
        for (const delta of result.answer.match(/[\s\S]{1,256}/gu) ?? []) await emit({ type: "token", delta });
      }
      return result;
    }, this.options.timeoutMs, input.signal);
  }

  private createGraph() {
    return new StateGraph(RagState)
      .addNode(
        "retrieve",
        async (state, runtime) => {
          const stepCount = assertStepBudget(state.stepCount + 1, this.options);
          const matches = await this.retriever.execute({ query: state.question, topK: state.topK, tenantId: state.tenantId, queryEmbedding: state.queryEmbedding, signal: runtime.signal });
          return { matches: matches.filter((match) => isSafeForAnswer(match.security)), stepCount };
        },
        { retryPolicy: { maxAttempts: 3, initialInterval: 0.25, maxInterval: 1, backoffFactor: 2 } }
      )
      .addNode("prepare_context", (state) => ({
        context: formatUntrustedContext(state.matches, this.options.maxContextChars),
        stepCount: assertStepBudget(state.stepCount + 1, this.options)
      }))
      .addNode("generate_answer", async (state, runtime) => {
        const stepCount = assertStepBudget(state.stepCount + 1, this.options);
        const rawAnswer = await this.answerGenerator.generate(state.question, state.context.text, runtime.signal);
        return { result: this.resolveAnswer(rawAnswer, state.context), stepCount };
      })
      .addNode("no_context", () => ({ result: insufficientContext }))
      .addEdge(START, "retrieve")
      .addConditionalEdges("retrieve", (state) =>
        this.hasRelevantSource(state.matches) ? "prepare_context" : "no_context"
      )
      .addConditionalEdges("prepare_context", (state) =>
        this.hasRelevantSource(state.context.sourcesByReference.values()) ? "generate_answer" : "no_context"
      )
      .addEdge("generate_answer", END)
      .addEdge("no_context", END)
      .compile();
  }

  private hasRelevantSource(sources: Iterable<{ score: number }>): boolean {
    for (const source of sources) {
      if (source.score >= this.options.minimumScore) return true;
    }
    return false;
  }

  private resolveAnswer(rawAnswer: string, context: GroundedContext): AnswerQuestionResult {
    const parsed = validateGroundedAnswer(parseGroundedAnswer(rawAnswer), new Set(context.sourcesByReference.keys()));
    if (this.options.requireStructuredOutput && !parsed.structured) {
      return { answer: "I could not validate the model's structured response, so I am declining to answer.", sources: [], citedChunkIds: [], structuredOutput: false, refusalReason: "unstructured_model_output" };
    }
    if (parsed.refusalReason) {
      return { answer: redactPii(parsed.answer).text, sources: [], citedChunkIds: [], structuredOutput: parsed.structured, refusalReason: redactPii(parsed.refusalReason).text };
    }
    const contextSources = [...context.sourcesByReference.values()];
    const sources = parsed.structured
      ? [...new Set(parsed.citedChunkIds)].flatMap((reference) => context.sourcesByReference.get(reference) ?? [])
      : contextSources;
    return {
      answer: redactPii(parsed.answer).text,
      sources,
      contextSources,
      citedChunkIds: parsed.structured ? sources.map((source) => source.chunkId) : [],
      structuredOutput: parsed.structured
    };
  }
}

