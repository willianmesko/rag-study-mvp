import type { QuestionAnsweringWorkflow, AnswerQuestionResult } from "../ports/question-answering-workflow.js";

export class AnswerQuestionUseCase {
  constructor(private readonly workflow: QuestionAnsweringWorkflow) {}

  execute(input: { question: string; topK?: number; tenantId?: string }): Promise<AnswerQuestionResult> {
    return this.workflow.answer(input);
  }
}

