import { ROOT, traceable } from "langsmith/traceable";
import type { Client } from "langsmith";
import { currentCorrelationId } from "../../../../platform/observability/observer.js";
import { currentExecution } from "../../../../platform/workflows/execution-context.js";
import type { AnswerQuestionResult, AnswerWorkflowEvent, AnswerWorkflowInput, QuestionAnsweringWorkflow } from "../../application/ports/question-answering-workflow.js";

type Outcome = { ok: true; value: AnswerQuestionResult } | { ok: false; error: unknown };
type Mode = "answer" | "answer_stream";
const uuid = (value: string | undefined) => value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : undefined;

function failureCode(error: unknown, signal?: AbortSignal): string {
  const reason: unknown = signal?.aborted ? signal.reason : error;
  if (reason instanceof Error && reason.name === "TimeoutError") return "deadline_exceeded";
  if (signal?.aborted || error instanceof Error && error.name === "AbortError") return "cancelled";
  return "workflow_failed";
}

export class LangSmithTracingWorkflow implements QuestionAnsweringWorkflow {
  constructor(
    private readonly workflow: QuestionAnsweringWorkflow,
    private readonly options: { enabled: boolean; projectName: string; client?: Client }
  ) {}

  answer(input: AnswerWorkflowInput): Promise<AnswerQuestionResult> {
    return this.run(input, "answer", () => this.workflow.answer(input));
  }

  answerStream(input: AnswerWorkflowInput, onEvent: (event: AnswerWorkflowEvent) => void | Promise<void>): Promise<AnswerQuestionResult> {
    return this.run(input, "answer_stream", () => this.workflow.answerStream
      ? this.workflow.answerStream(input, onEvent)
      : this.workflow.answer(input));
  }

  private async run(input: AnswerWorkflowInput, mode: Mode, work: () => Promise<AnswerQuestionResult>): Promise<AnswerQuestionResult> {
    let operation: Promise<Outcome> | undefined;
    // Retrying diagnostics must never replay generation or event delivery.
    const once = () => operation ??= Promise.resolve().then(work).then<Outcome, Outcome>(
      (value) => ({ ok: true, value }), (error: unknown) => ({ ok: false, error }));
    // Only the safe outer summary is traced. Keep prompts, history, events and
    // descendant graph/provider payloads outside the SDK's trace context.
    // ROOT prevents an ambient enabled RunTree from overriding the false flag.
    const suppressed = () => traceable(once, { tracingEnabled: false })(ROOT);
    if (!this.options.enabled || input.previousQuestions?.length) {
      const result = await suppressed();
      if (!result.ok) throw result.error;
      return result.value;
    }
    const lease = currentExecution()?.lease;
    const correlationId = uuid(lease?.correlationId ?? currentCorrelationId());
    const runId = uuid(lease?.runId);
    let failure: string | undefined;
    const traced = traceable(async () => {
      const result = await suppressed();
      if (!result.ok) {
        failure = failureCode(result.error, input.signal);
        // The original exception is rethrown outside the SDK, never serialized.
        return { outcome: failure };
      }
      return { outcome: "completed", sourceCount: result.value.sources.length,
        refused: Boolean(result.value.refusalReason) };
    }, {
      name: "rag-question-workflow",
      run_type: "chain",
      project_name: this.options.projectName,
      ...(this.options.client ? { client: this.options.client } : {}),
      tracingEnabled: true,
      metadata: { mode, ...(correlationId ? { correlation_id: correlationId } : {}), ...(runId ? { run_id: runId } : {}) },
      // No business payload is supplied as an SDK argument or return value.
      processInputs: () => ({ questionCharacters: input.question.length,
        ...(typeof input.topK === "number" && Number.isSafeInteger(input.topK) && input.topK >= 0 ? { topK: input.topK } : {}) }),
      on_end: (run) => { if (failure) run.error = failure; },
    });
    try { await traced(ROOT); } catch { /* Trace failure cannot change the answer. */ }
    const result = await (operation ?? suppressed());
    if (!result.ok) throw result.error;
    return result.value;
  }
}

