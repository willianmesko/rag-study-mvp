import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { workspaceChatModelPolicySchema, type WorkspaceChatModelPolicy, type WorkspaceChatModelPolicyResponse } from "@rag-study/contracts";
import { api, ApiError } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { workspaceRequestError } from "../../../shared/lib/request-error";
import { SelectField } from "../../../shared/ui/SelectField";

export function WorkspaceChatPolicy({ token, workspaceId }: { token: string; workspaceId: string }) {
  const { t } = useLocale();
  const client = useQueryClient();
  const queryKey = ["workspace-chat-policy", workspaceId, token] as const;
  const query = useQuery({ queryKey, retry: false, queryFn: ({ signal }) => api.chatModelPolicy(token, workspaceId, signal) });
  const save = useMutation({
    mutationFn: (policy: WorkspaceChatModelPolicy) => api.saveChatModelPolicy(token, workspaceId, policy),
    onSuccess: async (data) => {
      await client.cancelQueries({ queryKey, exact: true });
      client.setQueryData(queryKey, data);
      void client.invalidateQueries({ queryKey: ["chat-models"] });
    }
  });
  if (query.error instanceof ApiError && query.error.status === 404) return null;

  return <section className="panel space-y-4">
    <div>
      <h3 className="text-lg font-semibold text-white">{t("Chat model policy", "Política de modelos do chat")}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-300">{t("Choose which models your workspace can use and how automatic routing works.",
        "Escolha quais modelos seu espaço pode usar e como funciona a seleção automática.")}</p>
    </div>
    {query.isPending && <p role="status" className="text-sm text-slate-300">{t("Loading model policy…", "Carregando política de modelos…")}</p>}
    {query.isError && <div className="error-message space-y-3">
      <p role="alert">{workspaceRequestError(query.error, t, t("Could not load the policy.", "Não foi possível carregar a política."))}</p>
      <button type="button" className="secondary-button" disabled={query.isFetching} onClick={() => void query.refetch()}>{t("Try again", "Tentar novamente")}</button>
    </div>}
    {query.data && <PolicyForm key={`${workspaceId}:${JSON.stringify(query.data.policy)}`} data={query.data} pending={save.isPending}
      onEdit={save.reset} onSave={(policy) => save.mutate(policy)} />}
    {save.isError && <p className="error-message" role="alert">{workspaceRequestError(save.error, t, t("Could not save the model policy. Review your selections and try again.",
      "Não foi possível salvar a política. Revise as seleções e tente novamente."))}</p>}
    {save.isSuccess && <p className="success-message" role="status">{t("Model policy saved for this workspace.", "Política de modelos salva para este espaço.")}</p>}
  </section>;
}

function PolicyForm({ data, pending, onEdit, onSave }: { data: WorkspaceChatModelPolicyResponse; pending: boolean;
  onEdit: () => void; onSave: (policy: WorkspaceChatModelPolicy) => void }) {
  const { t } = useLocale();
  const [draft, setDraft] = useState(data.policy);
  const { allowedModelIds, defaultModelId, auto } = draft;
  const options = data.availableModels.filter(({ id }) => allowedModelIds.includes(id)).map(({ id, label }) => ({ value: id, label }));
  const changed = JSON.stringify(draft) !== JSON.stringify(data.policy);
  const valid = workspaceChatModelPolicySchema.safeParse(draft).success;
  const providerNames = { openrouter: "OpenRouter", bedrock: "Amazon Bedrock", ollama: "Ollama" };

  function edit(next: WorkspaceChatModelPolicy) {
    setDraft(next);
    onEdit();
  }

  function toggleModel(id: string, checked: boolean) {
    const enabled = checked ? [...allowedModelIds, id] : allowedModelIds.filter((item) => item !== id);
    if (enabled.length === 0) return;
    const nextDefault = enabled.includes(defaultModelId) ? defaultModelId : enabled[0]!;
    edit({ allowedModelIds: enabled, defaultModelId: nextDefault, auto: auto ? {
      simpleModelId: enabled.includes(auto.simpleModelId) ? auto.simpleModelId : nextDefault,
      complexModelId: enabled.includes(auto.complexModelId) ? auto.complexModelId : nextDefault,
      fallbackModelIds: auto.fallbackModelIds.filter((item) => enabled.includes(item))
    } : null });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (changed && valid && !pending) onSave(draft);
  }

  return <form onSubmit={submit} className="space-y-5" aria-busy={pending}>
    <fieldset disabled={pending} className="space-y-2">
      <legend className="mb-2 text-sm font-semibold text-slate-200">{t("Allowed models", "Modelos permitidos")}</legend>
      {data.availableModels.map(({ id, label, provider }) => {
        const checked = allowedModelIds.includes(id);
        return <label className="flex min-h-10 items-center gap-3 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200" key={id}>
          <input type="checkbox" className="size-4 shrink-0 accent-cyan-400" checked={checked} disabled={checked && allowedModelIds.length === 1}
            onChange={(event) => toggleModel(id, event.target.checked)} />
          <span className="min-w-0 [overflow-wrap:anywhere]">{label}<span className="ml-2 text-xs text-slate-400">{providerNames[provider]}</span></span>
        </label>;
      })}
    </fieldset>
    <SelectField label={t("Default model", "Modelo padrão")} value={defaultModelId} options={options} disabled={pending}
      onValueChange={(id) => edit({ ...draft, defaultModelId: id })} />
    <label className="flex min-h-11 items-center gap-3 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200">
      <input type="checkbox" className="size-4 shrink-0 accent-cyan-400" checked={Boolean(auto)} disabled={pending} onChange={(event) => edit({
        ...draft, auto: event.target.checked ? { simpleModelId: defaultModelId, complexModelId: defaultModelId, fallbackModelIds: [] } : null
      })} />
      {t("Allow automatic routing", "Permitir seleção automática")}
    </label>
    {auto && <fieldset className="space-y-3" disabled={pending}>
      <legend className="mb-2 text-sm font-semibold text-slate-200">{t("Automatic routing", "Seleção automática")}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label={t("Simple questions", "Perguntas simples")} value={auto.simpleModelId} options={options} disabled={pending}
          onValueChange={(simpleModelId) => edit({ ...draft, auto: { ...auto, simpleModelId } })} />
        <SelectField label={t("Complex questions", "Perguntas complexas")} value={auto.complexModelId} options={options} disabled={pending}
          onValueChange={(complexModelId) => edit({ ...draft, auto: { ...auto, complexModelId } })} />
      </div>
      <p className="text-sm text-slate-300">{t("Fallbacks are tried in order if a provider fails and the request budget allows it.",
        "As alternativas são tentadas na ordem indicada se o provedor falhar e o orçamento da pergunta permitir.")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: Math.min(3, options.length, auto.fallbackModelIds.length + 1) }, (_, index) => <SelectField key={index}
          label={t(`Fallback ${index + 1}`, `Alternativa ${index + 1}`)} value={auto.fallbackModelIds[index] ?? "__none"} disabled={pending}
          options={[{ value: "__none", label: t("No fallback", "Sem alternativa") }, ...options.filter(({ value }) =>
            !auto.fallbackModelIds.some((id, position) => id === value && position !== index))]}
          onValueChange={(id) => {
            const fallbackModelIds = [...auto.fallbackModelIds];
            if (id === "__none") fallbackModelIds.splice(index, 1);
            else fallbackModelIds[index] = id;
            edit({ ...draft, auto: { ...auto, fallbackModelIds } });
          }} />)}
      </div>
    </fieldset>}
    <button type="submit" className="primary-button" disabled={!changed || !valid || pending}>
      {pending ? t("Saving policy…", "Salvando política…") : t("Save model policy", "Salvar política de modelos")}
    </button>
  </form>;
}
