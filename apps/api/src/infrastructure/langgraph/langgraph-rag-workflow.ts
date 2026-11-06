import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { AnswerGenerator } from "../../application/ports/answer-generator.js";
import type { AnswerQuestionResult, AnswerWorkflowEvent, QuestionAnsweringWorkflow } from "../../application/ports/question-answering-workflow.js";
import { formatUntrustedContext, type GroundedContext } from "../../application/policies/grounded-answer-policy.js";
import { assertStepBudget, withExecutionTimeout } from "../../application/policies/agent-execution-policy.js";
import { parseGroundedAnswer, validateGroundedAnswer } from "../../application/policies/structured-answer.js";
import type { RetrievedChunk } from "../../domain/document.js";
import { isSafeForAnswer } from "../../domain/security/prompt-injection.js";

type Retriever = {
  execute(input: { query: string; topK?: number; tenantId?: string; queryEmbedding?: number[] }): Promise<RetrievedChunk[]>;
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

  async answer(input: { question: string; topK?: number; tenantId?: string; queryEmbedding?: number[] }): Promise<AnswerQuestionResult> {
    const output = await withExecutionTimeout(this.graph.invoke(input), this.options.timeoutMs);
    return output.result;
  }

  async answerStream(input: { question: string; topK?: number; tenantId?: string; queryEmbedding?: number[] }, onEvent: (event: AnswerWorkflowEvent) => void | Promise<void>): Promise<AnswerQuestionResult> {
    await onEvent({ type: "retrieving" });
    const matches = (await this.retriever.execute({ query: input.question, topK: input.topK, tenantId: input.tenantId, queryEmbedding: input.queryEmbedding })).filter((match) => isSafeForAnswer(match.security));
    const context = formatUntrustedContext(matches, this.options.maxContextChars);
    if (!this.hasRelevantSource(context.sourcesByReference.values())) {
      await onEvent({ type: "validating" });
      return insufficientContext;
    }
    await onEvent({ type: "generating" });
    const rawAnswer = this.answerGenerator.stream
      ? await withExecutionTimeout(this.answerGenerator.stream(input.question, context.text, () => undefined), this.options.timeoutMs)
      : await withExecutionTimeout(this.answerGenerator.generate(input.question, context.text), this.options.timeoutMs);
    await onEvent({ type: "validating" });
    const result = this.resolveAnswer(rawAnswer, context);
    if (!result.refusalReason) {
      for (const delta of result.answer.match(/[\s\S]{1,48}/gu) ?? []) await onEvent({ type: "token", delta });
    }
    return result;
  }

  private createGraph() {
    return new StateGraph(RagState)
      .addNode(
        "retrieve",
        async (state) => {
          const stepCount = assertStepBudget(state.stepCount + 1, this.options);
          const matches = await this.retriever.execute({ query: state.question, topK: state.topK, tenantId: state.tenantId, queryEmbedding: state.queryEmbedding });
          return { matches: matches.filter((match) => isSafeForAnswer(match.security)), stepCount };
        },
        { retryPolicy: { maxAttempts: 3, initialInterval: 0.25, maxInterval: 1, backoffFactor: 2 } }
      )
      .addNode("prepare_context", (state) => ({
        context: formatUntrustedContext(state.matches, this.options.maxContextChars),
        stepCount: assertStepBudget(state.stepCount + 1, this.options)
      }))
      .addNode("generate_answer", async (state) => {
        const stepCount = assertStepBudget(state.stepCount + 1, this.options);
        const rawAnswer = await withExecutionTimeout(this.answerGenerator.generate(state.question, state.context.text), this.options.timeoutMs);
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
      return { answer: parsed.answer, sources: [], citedChunkIds: [], structuredOutput: parsed.structured, refusalReason: parsed.refusalReason };
    }
    const sources = parsed.structured
      ? [...new Set(parsed.citedChunkIds)].flatMap((reference) => context.sourcesByReference.get(reference) ?? [])
      : [...context.sourcesByReference.values()];
    return {
      answer: parsed.answer,
      sources,
      citedChunkIds: parsed.structured ? sources.map((source) => source.chunkId) : [],
      structuredOutput: parsed.structured
    };
  }
}

