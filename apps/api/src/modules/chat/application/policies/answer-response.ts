import type {
  ChatModelDescriptor,
  QuestionResponse,
  ChatRunEvent,
} from "@rag-study/contracts";
import type {
  AnswerQuestionResult,
  AnswerWorkflowEvent,
} from "../ports/question-answering-workflow.js";
import { redactPii } from "../../../../platform/security/pii-redaction.js";

export function publicPassageExcerpt(content: string) {
  const text = redactPii(content).text;
  const excerpt = text.slice(0, 600).replace(/[\uD800-\uDBFF]$/u, "");
  return { excerpt, excerptTruncated: excerpt.length < text.length };
}
export function publicAnswerSource(
  source: AnswerQuestionResult["sources"][number],
) {
  return {
    chunkId: source.chunkId,
    documentId: source.documentId,
    source: source.source,
    title: source.title,
    chunk: source.ordinal,
    score: source.score,
    ...publicPassageExcerpt(source.content),
  };
}
export function publicAnswerResponse(
  result: AnswerQuestionResult,
  model: ChatModelDescriptor | undefined = result.model,
): QuestionResponse {
  return {
    answer: result.answer,
    citedChunkIds: result.citedChunkIds ?? [],
    structuredOutput: result.structuredOutput ?? false,
    refusalReason: result.refusalReason ?? null,
    sources: result.sources.map(publicAnswerSource),
    contextSources: result.contextSources?.map(publicAnswerSource) ?? [],
    cacheHit: result.cacheHit ?? false,
    ...(model ? { model } : {}),
    ...(result.providerModel ? { providerModel: result.providerModel } : {}),
    ...(result.routing ? { routing: result.routing } : {}),
    ...(result.usage ? { usage: result.usage } : {}),
    ...(result.claimVerification
      ? { claimVerification: result.claimVerification }
      : {}),
    ...(result.repaired !== undefined ? { repaired: result.repaired } : {}),
    ...(result.retrievalAttempts
      ? { retrievalAttempts: result.retrievalAttempts }
      : {}),
  };
}
export function publicWorkflowEvent(event: AnswerWorkflowEvent): ChatRunEvent {
  return event.type === "citations"
    ? { type: "citations", sources: event.sources.map(publicAnswerSource) }
    : event;
}
