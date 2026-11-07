import { publicAnswerResponse, publicWorkflowEvent } from "../application/policies/answer-response.js";
import type { AnswerQuestionResult, AnswerWorkflowEvent } from "../application/ports/question-answering-workflow.js";
import type { ChatRunEvent } from "@rag-study/contracts";

export function serializeQuestionAnswer(result: AnswerQuestionResult, model = result.model) {
  return publicAnswerResponse(result, model);
}

export function serializeWorkflowEvent(event: AnswerWorkflowEvent): ChatRunEvent {
  return publicWorkflowEvent(event);
}
