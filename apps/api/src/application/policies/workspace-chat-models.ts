import type { ChatModelDescriptor, WorkspaceChatModelPolicy } from "@rag-study/contracts";

export function defaultWorkspaceChatPolicy(models: ReadonlyMap<string, unknown>): WorkspaceChatModelPolicy {
  return { allowedModelIds: [...models.keys()], defaultModelId: "default", auto: null };
}

export function resolveWorkspaceChatModels<T extends { descriptor: ChatModelDescriptor }>(
  models: ReadonlyMap<string, T>, policy: WorkspaceChatModelPolicy
) {
  const available = policy.allowedModelIds.flatMap((id) => {
    const model = models.get(id);
    return model ? [model] : [];
  });
  const defaultModelId = available.find(({ descriptor }) => descriptor.id === policy.defaultModelId)?.descriptor.id
    ?? available[0]?.descriptor.id;
  const active = new Map(available.map((model) => [
    model.descriptor.id, { ...model, descriptor: { ...model.descriptor, isDefault: model.descriptor.id === defaultModelId } }
  ]));
  const auto = policy.auto && active.has(policy.auto.simpleModelId) && active.has(policy.auto.complexModelId)
    ? policy.auto : null;
  return { models: active, defaultModelId, auto };
}
