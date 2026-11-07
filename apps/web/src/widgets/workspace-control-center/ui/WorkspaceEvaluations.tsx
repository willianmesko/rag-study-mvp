import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api } from "../../../shared/api/rag-api";
import { DemoLibraryDialog } from "../../../features/demo-libraries/ui/DemoLibraryDialog";
import { useLocale } from "../../../shared/i18n/locale";
import { workspaceRequestError } from "../../../shared/lib/request-error";
import { SelectField } from "../../../shared/ui/SelectField";
import { effortLabels, evaluationEfforts, type EvaluationEffort } from "../model/evaluation-quality";
import { evaluationsQuery } from "../model/queries";
import { EvaluationPanel } from "./EvaluationPanel";
import { WorkspaceQueryFeedback } from "./WorkspaceQueryFeedback";
import { WorkspacePageHeader } from "./WorkspacePageHeader";

export function WorkspaceEvaluations({ workspaceId, token }: { workspaceId: string; token: string }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const evaluationOptions = evaluationsQuery(token, workspaceId);
  const evaluations = useQuery(evaluationOptions);
  const [includeFaithfulness, setIncludeFaithfulness] = useState(false);
  const [modelId, setModelId] = useState<string | undefined>();
  const [effort, setEffort] = useState<EvaluationEffort>("standard");
  const [referenceOpen, setReferenceOpen] = useState(false);
  const referenceUnavailable = evaluations.data?.reference?.ready === false;
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
    mutationFn: () => api.runEvaluation(token, workspaceId, judgingRequested ? { includeFaithfulness: true, modelId: selectedModel?.id, effort } : {}),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: evaluationOptions.queryKey }); }
  });

  return <div className="space-y-4">
    <WorkspacePageHeader title={t("Evaluations", "Avaliações")} description={t("Review search quality and answer safety.", "Confira a qualidade da busca e a segurança das respostas.")}>
      <button className="primary-button" type="button" onClick={() => runEvaluation.mutate()}
        disabled={runEvaluation.isPending || referenceUnavailable || evaluations.isLoading || evaluations.isError || (judgingRequested && !selectedModel)}>
        {runEvaluation.isPending ? t("Running…", "Avaliando…") : t("Run evaluation", "Executar avaliação")}
      </button>
    </WorkspacePageHeader>
    {referenceUnavailable && <section className="space-y-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-4" aria-label={t("Reference benchmark setup", "Preparação do benchmark de referência")}>
      <p className="text-sm leading-6 text-amber-100" role="status">{["queued", "processing"].includes(evaluations.data?.reference?.state ?? "")
        ? t("The reference document is being prepared. The evaluation becomes available when it is ready.", "O documento de referência está sendo preparado. A avaliação ficará disponível quando ele estiver pronto.")
        : t("This four-question benchmark requires the RAG Fundamentals reference document. It is missing from this workspace, so running it would not measure your own documents’ quality.", "Este benchmark de quatro perguntas exige o documento de referência RAG Fundamentals. Ele está ausente neste espaço; executá-lo não mediria a qualidade dos seus próprios documentos.")}</p>
      <button className="secondary-button" type="button" aria-haspopup="dialog" onClick={() => setReferenceOpen(true)}>{t("Prepare reference benchmark", "Preparar benchmark de referência")}</button>
    </section>}
    {referenceOpen && <DemoLibraryDialog token={token} workspaceId={workspaceId} role="owner" initialId="rag-reference"
      onClose={() => setReferenceOpen(false)} onImported={() => { void queryClient.invalidateQueries({ queryKey: evaluationOptions.queryKey }); }} />}
    {evaluations.isError && <WorkspaceQueryFeedback query={evaluations} loading={t("Loading evaluations…", "Carregando avaliações…")}
      failure={t("We could not load evaluations.", "Não foi possível carregar as avaliações.")} />}
    {(evaluations.data || !evaluations.isError) && <EvaluationPanel runs={evaluations.data?.runs ?? []} isLoading={evaluations.isLoading}
      runOptions={judgingEnabled ? <details className="border-b border-slate-800 pb-4 text-sm">
        <summary className="min-h-11 rounded-lg py-2 font-medium text-slate-200">{t("Evaluation options", "Opções de avaliação")}</summary>
        <div className="mt-3 space-y-3">
        <label className="flex items-center gap-2 text-slate-200">
          <input type="checkbox" checked={includeFaithfulness} onChange={(event) => setIncludeFaithfulness(event.target.checked)} disabled={runEvaluation.isPending} />
          {t("Also measure faithfulness", "Medir fidelidade também")}
        </label>
        <p className="text-xs text-slate-400">{t("This runs extra model requests on bundled public examples. Workspace content stays out of the judge.", "Esta opção faz chamadas adicionais aos modelos com exemplos públicos do projeto. O avaliador não recebe conteúdo do espaço.")}</p>
        {judgingRequested && <>
          <WorkspaceQueryFeedback query={catalog} loading={t("Loading answer models…", "Carregando modelos de resposta…")} failure={t("Could not load answer models.", "Não foi possível carregar os modelos de resposta.")} />
          {selectedModel && <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label={t("Answer model", "Modelo de resposta")} value={selectedModel.id} onValueChange={setModelId}
              options={models.map(({ id, label, provider }) => ({ value: id, label, description: provider }))} disabled={runEvaluation.isPending} />
            <SelectField label={t("Answer effort", "Esforço da resposta")} value={effort} onValueChange={(value) => {
              const selected = evaluationEfforts.find((item) => item === value);
              if (selected) setEffort(selected);
            }} options={evaluationEfforts.map((value) => ({ value, label: t(...effortLabels[value]) }))} disabled={runEvaluation.isPending} />
            <p className="text-xs text-slate-400 sm:col-span-2">{t("Effort sets the answer token limit. The questions, passages and prompt stay the same.", "O esforço define o limite de tokens da resposta. As perguntas, os trechos e o prompt são os mesmos.")}</p>
          </div>}
        </>}
        </div>
      </details> : undefined} />}
    {runEvaluation.isSuccess && <p className="success-message" role="status">{t("Evaluation completed and saved.", "Avaliação concluída e salva.")}</p>}
    {runEvaluation.isError && <p className="error-message" role="alert">{runEvaluation.error instanceof ApiError && runEvaluation.error.code === "evaluation_reference_missing"
      ? t("Prepare the reference benchmark document before running this evaluation.", "Prepare o documento do benchmark de referência antes de executar esta avaliação.")
      : workspaceRequestError(runEvaluation.error, t, t("We could not run the evaluation.", "Não foi possível executar a avaliação."))}</p>}
  </div>;
}
