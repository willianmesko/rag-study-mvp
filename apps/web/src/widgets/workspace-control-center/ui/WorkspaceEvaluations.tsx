import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { workspaceRequestError } from "../../../shared/lib/request-error";
import { evaluationsQuery } from "../model/queries";
import { EvaluationPanel } from "./EvaluationPanel";
import { WorkspaceQueryFeedback } from "./WorkspaceQueryFeedback";

export function WorkspaceEvaluations({ workspaceId, token }: { workspaceId: string; token: string }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const evaluationOptions = evaluationsQuery(token, workspaceId);
  const evaluations = useQuery(evaluationOptions);
  const runEvaluation = useMutation({
    mutationFn: () => api.runEvaluation(token, workspaceId),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: evaluationOptions.queryKey }); }
  });

  return <div className="space-y-4">
    {evaluations.isError && <WorkspaceQueryFeedback query={evaluations} loading={t("Loading evaluations…", "Carregando avaliações…")}
      failure={t("We could not load evaluations.", "Não foi possível carregar as avaliações.")} />}
    {(evaluations.data || !evaluations.isError) && <EvaluationPanel runs={evaluations.data?.runs ?? []} isLoading={evaluations.isLoading}
      isRunning={runEvaluation.isPending} onRun={() => runEvaluation.mutate()} />}
    {runEvaluation.isSuccess && <p className="success-message" role="status">{t("Evaluation completed and saved.", "Avaliação concluída e salva.")}</p>}
    {runEvaluation.isError && <p className="error-message" role="alert">{workspaceRequestError(runEvaluation.error, t, t("We could not run the evaluation.", "Não foi possível executar a avaliação."))}</p>}
  </div>;
}
