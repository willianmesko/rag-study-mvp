import type { ChatRunEvent, QuestionResponse } from "@rag-study/contracts";
import type { ChatRunScope } from "./chat-run-repository.js";

export interface ChatExecutionWorkflow {
  readonly version: string;
  execute(scope: ChatRunScope, work: {
    reserveQuota: () => Promise<boolean>;
    answer: (
      signal: AbortSignal,
      publish: (event: ChatRunEvent) => Promise<void>,
    ) => Promise<QuestionResponse>;
  }, signal: AbortSignal): Promise<void>;
}
