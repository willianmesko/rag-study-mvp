import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { AnswerGenerator } from "../../application/ports/answer-generator.js";
import type { AnswerQuestionResult, QuestionAnsweringWorkflow } from "../../application/ports/question-answering-workflow.js";
import { formatUntrustedContext } from "../../application/policies/grounded-answer-policy.js";
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
  answer: Annotation<string>()
});

export class LangGraphRagWorkflow implements QuestionAnsweringWorkflow {
  private readonly graph;

  constructor(
    private readonly retriever: Retriever,
    private readonly answerGenerator: AnswerGenerator,
    private readonly options: { maxContextChars: number; minimumScore: number }
  ) {
    this.graph = this.createGraph();
  }

  async answer(input: { question: string; topK?: number; tenantId?: string; queryEmbedding?: number[] }): Promise<AnswerQuestionResult> {
    const output = await this.graph.invoke(input);
    if (!output.hasContext) {
      return { answer: output.answer, sources: [] };
    }
    return {
      answer: output.answer,
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

  private createGraph() {
    return new StateGraph(RagState)
      .addNode(
        "retrieve",
        async (state) => {
          const matches = await this.retriever.execute({ query: state.question, topK: state.topK, tenantId: state.tenantId, queryEmbedding: state.queryEmbedding });
          return { matches: matches.filter((match) => isSafeForAnswer(match.security)) };
        },
        { retryPolicy: { maxAttempts: 3, initialInterval: 0.25, maxInterval: 1, backoffFactor: 2 } }
      )
      .addNode("prepare_context", (state) => ({ context: this.buildContext(state.matches), hasContext: true }))
      .addNode("generate_answer", async (state) => ({
        answer: await this.answerGenerator.generate(state.question, state.context)
      }))
      .addNode("no_context", () => ({
        answer: "I could not find sufficiently relevant context in the indexed documents to answer safely.",
        hasContext: false
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

