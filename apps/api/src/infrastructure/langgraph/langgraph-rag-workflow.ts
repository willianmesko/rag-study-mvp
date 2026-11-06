import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { AnswerGenerator } from "../../application/ports/answer-generator.js";
import type { AnswerQuestionResult, AnswerWorkflowEvent, QuestionAnsweringWorkflow } from "../../application/ports/question-answering-workflow.js";
import { formatUntrustedContext } from "../../application/policies/grounded-answer-policy.js";
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
  context: Annotation<string>(),
  hasContext: Annotation<boolean>(),
  answer: Annotation<string>(),
  citedChunkIds: Annotation<string[]>(),
  structuredOutput: Annotation<boolean>(),
  refusalReason: Annotation<string | undefined>(),
  stepCount: Annotation<number>({ reducer: (_previous, next) => next, default: () => 0 })
});

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
    if (!output.hasContext) {
      return { answer: output.answer, sources: [], citedChunkIds: [], structuredOutput: output.structuredOutput ?? false, refusalReason: output.refusalReason };
    }
    return {
      answer: output.answer,
      citedChunkIds: output.citedChunkIds ?? [],
      structuredOutput: output.structuredOutput ?? false,
      refusalReason: output.refusalReason,
      sources: output.matches.map(({ chunkId, documentId, source, title, ordinal, score, content }) => ({
        chunkId,
        documentId,
        source,
        title,
        ordinal,
        score,
        content
      }))
    };
  }

  async answerStream(input: { question: string; topK?: number; tenantId?: string; queryEmbedding?: number[] }, onEvent: (event: AnswerWorkflowEvent) => void | Promise<void>): Promise<AnswerQuestionResult> {
    await onEvent({ type: "retrieving" });
    const matches = (await this.retriever.execute({ query: input.question, topK: input.topK, tenantId: input.tenantId, queryEmbedding: input.queryEmbedding })).filter((match) => isSafeForAnswer(match.security));
    if (!matches.some((match) => match.score >= this.options.minimumScore)) {
      await onEvent({ type: "validating" });
      return { answer: "I could not find sufficiently relevant context in the indexed documents to answer safely.", sources: [], citedChunkIds: [], structuredOutput: true, refusalReason: "insufficient_context" };
    }
    await onEvent({ type: "generating" });
    const context = this.buildContext(matches);
    const rawAnswer = this.answerGenerator.stream
      ? await withExecutionTimeout(this.answerGenerator.stream(input.question, context, () => undefined), this.options.timeoutMs)
      : await withExecutionTimeout(this.answerGenerator.generate(input.question, context), this.options.timeoutMs);
    await onEvent({ type: "validating" });
    const parsed = validateGroundedAnswer(parseGroundedAnswer(rawAnswer), new Set(matches.map((match) => match.chunkId)));
    if (this.options.requireStructuredOutput && !parsed.structured) {
      return { answer: "I could not validate the model's structured response, so I am declining to answer.", sources: [], citedChunkIds: [], structuredOutput: false, refusalReason: "unstructured_model_output" };
    }
    for (const delta of parsed.answer.match(/.{1,48}(?:\s+|$)/g) ?? [parsed.answer]) await onEvent({ type: "token", delta });
    return {
      answer: parsed.answer,
      citedChunkIds: parsed.citedChunkIds,
      structuredOutput: parsed.structured,
      refusalReason: parsed.refusalReason ?? undefined,
      sources: matches.map(({ chunkId, documentId, source, title, ordinal, score, content }) => ({ chunkId, documentId, source, title, ordinal, score, content }))
    };
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
        context: this.buildContext(state.matches),
        hasContext: true,
        stepCount: assertStepBudget(state.stepCount + 1, this.options)
      }))
      .addNode("generate_answer", async (state) => {
        const rawAnswer = await withExecutionTimeout(this.answerGenerator.generate(state.question, state.context), this.options.timeoutMs);
        const parsed = validateGroundedAnswer(
          parseGroundedAnswer(rawAnswer),
          new Set(state.matches.map((match) => match.chunkId))
        );
        if (this.options.requireStructuredOutput && !parsed.structured) {
          return {
            answer: "I could not validate the model's structured response, so I am declining to answer.",
            citedChunkIds: [],
            structuredOutput: false,
            refusalReason: "unstructured_model_output",
            stepCount: assertStepBudget(state.stepCount + 1, this.options)
          };
        }
        return {
          answer: parsed.answer,
          citedChunkIds: parsed.citedChunkIds,
          structuredOutput: parsed.structured,
          refusalReason: parsed.refusalReason ?? undefined,
          stepCount: assertStepBudget(state.stepCount + 1, this.options)
        };
      })
      .addNode("no_context", () => ({
        answer: "I could not find sufficiently relevant context in the indexed documents to answer safely.",
        hasContext: false,
        citedChunkIds: [],
        structuredOutput: true,
        refusalReason: "insufficient_context",
        stepCount: 1
      }))
      .addEdge(START, "retrieve")
      .addConditionalEdges("retrieve", (state) =>
        state.matches.some((match) => match.score >= this.options.minimumScore) ? "prepare_context" : "no_context"
      )
      .addEdge("prepare_context", "generate_answer")
      .addEdge("generate_answer", END)
      .addEdge("no_context", END)
      .compile();
  }

  private buildContext(matches: RetrievedChunk[]): string {
    return formatUntrustedContext(matches, this.options.maxContextChars);
  }
}

