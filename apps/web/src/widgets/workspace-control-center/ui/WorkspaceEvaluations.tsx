import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { workspaceRequestError } from "../../../shared/lib/request-error";
import { SelectField } from "../../../shared/ui/SelectField";
import { evaluationsQuery } from "../model/queries";
import { EvaluationPanel } from "./EvaluationPanel";
import { WorkspaceQueryFeedback } from "./WorkspaceQueryFeedback";

export function WorkspaceEvaluations({ workspaceId, token }: { workspaceId: string; token: string }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const evaluationOptions = evaluationsQuery(token, workspaceId);
  const evaluations = useQuery(evaluationOptions);
  const [includeFaithfulness, setIncludeFaithfulness] = useState(false);
  const [modelId, setModelId] = useState<string | undefined>();
  const judgingEnabled = evaluations.data?.faithfulnessEnabled === true;
  const judgingRequested = judgingEnabled && includeFaithfulness;
  const catalog = useQuery({
    queryKey: ["evaluation-models", workspaceId, token],
    queryFn: ({ signal }) => api.chatModels(token, workspaceId, signal),
    enabled: judgingRequested
  });
  const models = catalog.data?.models ?? [];
  const selectedModel = models.find(({ id }) => id === modelId) ?? models.find(({ isDefault }) => isDefault);
  const runEvaluation = useMutation({
    mutationFn: () => api.runEvaluation(token, workspaceId, judgingRequested ? { includeFaithfulness: true, modelId: selectedModel?.id } : {}),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: evaluationOptions.queryKey }); }
  });

  return <div className="space-y-4">
    {evaluations.isError && <WorkspaceQueryFeedback query={evaluations} loading={t("Loading evaluations…", "Carregando avaliações…")}
      failure={t("We could not load evaluations.", "Não foi possível carregar as avaliações.")} />}
    {(evaluations.data || !evaluations.isError) && <EvaluationPanel runs={evaluations.data?.runs ?? []} isLoading={evaluations.isLoading}
      isRunning={runEvaluation.isPending} canRun={!judgingRequested || Boolean(selectedModel)} onRun={() => runEvaluation.mutate()}
      runOptions={judgingEnabled ? <div className="mt-4 space-y-3 rounded-xl border border-slate-700 p-4 text-sm">
        <label className="flex items-center gap-2 text-slate-200">
          <input type="checkbox" checked={includeFaithfulness} onChange={(event) => setIncludeFaithfulness(event.target.checked)} disabled={runEvaluation.isPending} />
          {t("Also measure faithfulness", "Medir fidelidade também")}
        </label>
        <p className="text-xs text-slate-400">{t("This runs extra model requests on bundled public examples. Workspace content stays out of the judge.", "Esta opção faz chamadas adicionais aos modelos com exemplos públicos do projeto. O avaliador não recebe conteúdo do espaço.")}</p>
        {judgingRequested && <>
          <WorkspaceQueryFeedback query={catalog} loading={t("Loading answer models…", "Carregando modelos de resposta…")} failure={t("Could not load answer models.", "Não foi possível carregar os modelos de resposta.")} />
          {selectedModel && <SelectField label={t("Answer model", "Modelo de resposta")} value={selectedModel.id} onValueChange={setModelId}
            options={models.map(({ id, label, provider }) => ({ value: id, label, description: provider }))} disabled={runEvaluation.isPending} />}
        </>}
      </div> : undefined} />}
    {runEvaluation.isSuccess && <p className="success-message" role="status">{t("Evaluation completed and saved.", "Avaliação concluída e salva.")}</p>}
    {runEvaluation.isError && <p className="error-message" role="alert">{workspaceRequestError(runEvaluation.error, t, t("We could not run the evaluation.", "Não foi possível executar a avaliação."))}</p>}
  </div>;
}
