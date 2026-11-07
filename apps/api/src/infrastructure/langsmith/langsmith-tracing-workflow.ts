import { traceable } from "langsmith/traceable";
import type { AnswerQuestionResult, AnswerWorkflowEvent, AnswerWorkflowInput, QuestionAnsweringWorkflow } from "../../application/ports/question-answering-workflow.js";

export class LangSmithTracingWorkflow implements QuestionAnsweringWorkflow {
  constructor(
    private readonly workflow: QuestionAnsweringWorkflow,
    private readonly options: { enabled: boolean; projectName: string }
  ) {}

  answer(input: AnswerWorkflowInput): Promise<AnswerQuestionResult> {
    if (input.previousQuestions?.length) {
      // Suppress nested LangGraph traces as well as the outer trace for history.
      return traceable(() => this.workflow.answer(input), { tracingEnabled: false })();
    }
    if (!this.options.enabled) return this.workflow.answer(input);

    const { signal, ...payload } = input;
    const traced = traceable(
      async (traceInput: typeof payload) => this.workflow.answer({ ...traceInput, signal }),
      {
        name: "rag-question-workflow",
        run_type: "chain",
        project_name: this.options.projectName,
        tracingEnabled: true,
        processOutputs: ({ contextSources: _contextSources, ...traceOutput }) => traceOutput
      }
    );
    return traced(payload);
  }

  answerStream(input: AnswerWorkflowInput, onEvent: (event: AnswerWorkflowEvent) => void | Promise<void>): Promise<AnswerQuestionResult> {
    if (!this.workflow.answerStream) return input.previousQuestions?.length ? this.answer(input) : this.workflow.answer(input);
    return this.workflow.answerStream(input, onEvent);
  }
}

