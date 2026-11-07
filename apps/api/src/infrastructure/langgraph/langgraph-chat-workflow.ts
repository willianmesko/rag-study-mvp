import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { ChatRunEvent, QuestionResponse } from "@rag-study/contracts";
import type {
  ChatRunRepository,
  ChatRunScope,
} from "../../application/ports/chat-run-repository.js";
import {
  currentExecution,
  workflowNode,
} from "../../application/workflows/execution-context.js";
import { WorkflowGuardError } from "../../application/workflows/types.js";
import { graphExecution } from "./graph-execution.js";

export const chatWorkflowVersion = "chat-v2";
const State = Annotation.Root({
  runId: Annotation<string>,
  response: Annotation<QuestionResponse>,
  publishedCount: Annotation<number>,
});

export class LangGraphChatWorkflow {
  constructor(private readonly repository: ChatRunRepository) {}
  async execute(
    scope: ChatRunScope,
    work: {
      reserveQuota: () => Promise<boolean>;
      answer: (
        signal: AbortSignal,
        publish: (event: ChatRunEvent) => Promise<void>,
      ) => Promise<QuestionResponse>;
    },
    signal: AbortSignal,
  ) {
    const current = await this.repository.get(scope);
    if (current === "completed") return;
    if (current !== "running")
      throw new WorkflowGuardError(
        current === "cancelled" ? "cancelled" : "deadline_exceeded",
      );
    const publish = async (event: ChatRunEvent) => {
      signal.throwIfAborted();
      // Draft/citation events are released together only after the complete result is checked.
      if (event.type === "token" || event.type === "citations") return;
      if (!(await this.repository.append(scope, [event])))
        throw new WorkflowGuardError("lease_lost");
    };
    const execution = graphExecution(chatWorkflowVersion);
    const graph = new StateGraph(State)
      .addNode("quota", () =>
        workflowNode("chat_quota", async () => {
          if (!(await work.reserveQuota()))
            throw new Error("Daily question quota reached.");
          return {};
        }),
      )
      .addNode("answer", () =>
        workflowNode("chat_answer", async () => {
          const response = await work.answer(signal, publish);
          return {
            response,
            publishedCount: currentExecution()?.publications.next ?? 0,
          };
        }),
      )
      .addNode("publish", (state) =>
        workflowNode("chat_publish", async () => {
          const { response } = state;
          const execution = currentExecution();
          if (execution) execution.publications.next = state.publishedCount;
          const events: ChatRunEvent[] = [];
          if (
            !response.refusalReason &&
            response.structuredOutput &&
            response.sources.length
          ) {
            events.push({ type: "citations", sources: response.sources });
            for (const delta of response.answer.match(/[\s\S]{1,256}/gu) ?? [])
              events.push({ type: "token", delta });
          }
          events.push({ type: "completed", response });
          if (!(await this.repository.append(scope, events, "completed")))
            throw new WorkflowGuardError("lease_lost");
          return {};
        }),
      )
      .addEdge(START, "quota")
      .addEdge("quota", "answer")
      .addEdge("answer", "publish")
      .addEdge("publish", END)
      .compile({ checkpointer: execution?.saver });
    const initial = { runId: scope.runId };
    const input = execution
      ? await execution.input(initial, () => graph.getState(execution.config))
      : initial;
    await graph.invoke(input, {
      ...execution?.config,
      signal,
      recursionLimit: 50,
    });
  }
}
