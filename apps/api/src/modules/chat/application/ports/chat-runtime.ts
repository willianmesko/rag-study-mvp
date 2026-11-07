import type { ChatRunEvent, QuestionResponse } from "@rag-study/contracts";
import type { EvaluationModel } from "../../../evaluations/index.js";
import type { AnswerQuestionUseCase } from "../use-cases/answer-question.js";
import type { ChatRunScope } from "./chat-run-repository.js";

export type ResolvedWorkflowChat = {
  modelId: string;
  signature: string;
  execute: AnswerQuestionUseCase["execute"];
};

export interface ChatRuntimeBindings {
  chatVersion: string;
  resolveChat(tenantId: string, modelId?: string): Promise<ResolvedWorkflowChat | null>;
  resolveEvaluationModel(tenantId: string, modelId: string | undefined, requestedMaxOutputTokens: number): Promise<EvaluationModel | undefined>;
  consumeQuota(tenantId: string, actorKey: string): Promise<boolean>;
  runChat(scope: ChatRunScope, work: {
    reserveQuota: () => Promise<boolean>;
    answer: (signal: AbortSignal, publish: (event: ChatRunEvent) => Promise<void>) => Promise<QuestionResponse>;
  }, signal: AbortSignal): Promise<void>;
}
