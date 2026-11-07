import type { AnswerQuestionUseCase } from "../application/use-cases/answer-question.js";
import type { RouteAnswerUseCase } from "../application/use-cases/route-answer.js";
import type { ComparisonModel } from "../application/use-cases/compare-answers.js";
import type { WorkspaceModelPolicyRepository } from "../application/ports/workspace-model-policy-repository.js";
import type { QuotaResult } from "../../usage/index.js";
import { defaultWorkspaceChatPolicy, resolveWorkspaceChatModels } from "../application/policies/workspace-chat-models.js";

export type HttpChatModel = ComparisonModel & { answerQuestion: Pick<AnswerQuestionUseCase, "execute"> };
export type QuestionQuotaConsumer = (tenantId: string, actorKey: string, units?: 1 | 2, receiptKey?: string) => Promise<QuotaResult>;
export const modelUnavailable = { code: "model_unavailable", error: "Select an available chat model." } as const;

export function createChatModelSelection(dependencies: {
  models: ReadonlyMap<string, HttpChatModel>;
  policies?: Pick<WorkspaceModelPolicyRepository, "get">;
  answerQuestion: Pick<AnswerQuestionUseCase, "execute">;
  routeAnswer: Pick<RouteAnswerUseCase, "execute">;
  consumeQuestionQuota: QuestionQuotaConsumer;
}) {
  const globalChatModels = dependencies.models;
  const defaultChatPolicy = defaultWorkspaceChatPolicy(globalChatModels);
  async function workspaceChatModels(tenantId?: string) {
    const policy = tenantId ? await dependencies.policies?.get(tenantId) : null;
    return resolveWorkspaceChatModels(globalChatModels, policy ?? defaultChatPolicy);
  }
  async function chooseAnswer(tenantId: string | undefined, modelId?: string) {
    if (!modelId && globalChatModels.size === 0) return dependencies.answerQuestion.execute.bind(dependencies.answerQuestion);
    const profile = await workspaceChatModels(tenantId);
    if (modelId === "auto") {
      const auto = profile.auto;
      const simple = auto && profile.models.get(auto.simpleModelId);
      const complex = auto && profile.models.get(auto.complexModelId);
      if (!auto || !simple || !complex) return null;
      const fallbacks = auto.fallbackModelIds.flatMap((id) => {
        const model = profile.models.get(id);
        return model ? [model] : [];
      });
      return (input: Parameters<AnswerQuestionUseCase["execute"]>[0]) =>
        dependencies.routeAnswer.execute({ ...input, simple, complex, fallbacks,
          reserveFallbackQuota: async (id) => (await dependencies.consumeQuestionQuota(input.tenantId, input.actorKey, undefined, `fallback:${id}`)).allowed });
    }
    const model = profile.models.get(modelId ?? profile.defaultModelId ?? "");
    if (!model) return null;
    return async (input: Parameters<AnswerQuestionUseCase["execute"]>[0]) =>
      ({ ...await model.answerQuestion.execute(input), model: model.descriptor, providerModel: model.model });
  }
  return { globalChatModels, defaultChatPolicy, workspaceChatModels, chooseAnswer };
}

export type ChatModelSelection = ReturnType<typeof createChatModelSelection>;
