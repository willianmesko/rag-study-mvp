import { traceable } from "langsmith/traceable";
import type { AnswerQuestionResult, QuestionAnsweringWorkflow } from "../../application/ports/question-answering-workflow.js";

export class LangSmithTracingWorkflow implements QuestionAnsweringWorkflow {
  constructor(
    private readonly workflow: QuestionAnsweringWorkflow,
    private readonly options: { enabled: boolean; projectName: string }
  ) {}

  answer(input: { question: string; topK?: number }): Promise<AnswerQuestionResult> {
    if (!this.options.enabled) return this.workflow.answer(input);

    const traced = traceable(
      async (payload: { question: string; topK?: number }) => this.workflow.answer(payload),
      { name: "rag-question-workflow", run_type: "chain", project_name: this.options.projectName, tracingEnabled: true }
    );
    return traced(input);
  }
}

