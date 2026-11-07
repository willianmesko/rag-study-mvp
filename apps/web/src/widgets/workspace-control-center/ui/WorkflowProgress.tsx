import { useMutation } from "@tanstack/react-query";
import type { WorkflowSnapshot } from "@rag-study/contracts";
import { api } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { workspaceRequestError } from "../../../shared/lib/request-error";

export function WorkflowProgress({
  runs,
  token,
  workspaceId,
  onChanged,
}: {
  runs: WorkflowSnapshot[];
  token: string;
  workspaceId: string;
  onChanged: () => void;
}) {
  const { locale, t } = useLocale();
  const action = useMutation({
    mutationFn: ({
      runId,
      action,
    }: {
      runId: string;
      action: "approve" | "cancel";
    }) => api.actOnEvaluationWorkflow(token, workspaceId, runId, action),
    onSuccess: onChanged,
  });
  const labels = {
    queued: t("Queued", "Na fila"),
    running: t("In progress", "Em andamento"),
    waiting_approval: t(
      "Waiting for your approval",
      "Aguardando sua aprovação",
    ),
    completed: t("Completed", "Concluída"),
    failed: t("Stopped", "Interrompida"),
    cancelled: t("Cancelled", "Cancelada"),
  };
  const stages: Record<string, string> = {
    approval: t("Approval", "Aprovação"),
    retrieve_cases: t(
      "Finding reference passages",
      "Buscando trechos de referência",
    ),
    retrieval_metrics: t(
      "Measuring search quality",
      "Medindo a qualidade da busca",
    ),
    calibrate: t("Checking the evaluator", "Conferindo o avaliador"),
    generate_answers: t(
      "Preparing sample answers",
      "Preparando respostas de exemplo",
    ),
    score_faithfulness: t("Checking supporting evidence", "Conferindo as evidências"),
    context_precision: t(
      "Reviewing passage relevance",
      "Revisando a relevância dos trechos",
    ),
    security: t("Checking safety cases", "Conferindo os casos de segurança"),
    evaluation_report: t("Saving the report", "Salvando o relatório"),
  };
  const currency = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  });
  return (
    <section
      aria-label={t("Evaluation progress", "Progresso das avaliações")}
      className="divide-y divide-slate-800 rounded-xl border border-slate-800 px-4"
    >
      {runs.length === 0 && (
        <p className="py-4 text-sm text-slate-400">
          {t(
            "New evaluations can resume after a service restart. Their progress appears here.",
            "Novas avaliações podem continuar após uma reinicialização do serviço. O progresso aparece aqui.",
          )}
        </p>
      )}
      {runs.slice(0, 5).map((run) => {
        const active = ["queued", "running", "waiting_approval"].includes(
          run.status,
        );
        return (
          <article
            className="space-y-3 py-4"
            key={run.runId}
            aria-label={t("Evaluation workflow", "Execução da avaliação")}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p
                className="text-sm font-medium text-slate-100"
                role={active ? "status" : undefined}
              >
                {labels[run.status]}
              </p>
              <time className="text-xs text-slate-400" dateTime={run.createdAt}>
                {new Date(run.createdAt).toLocaleString(locale)}
              </time>
            </div>
            {run.stage && (
              <p className="text-sm text-slate-300">
                {stages[run.stage] ??
                  t("Preparing evaluation", "Preparando avaliação")}
              </p>
            )}
            <p className="text-xs leading-5 text-slate-400">
              {t("Provider calls", "Chamadas aos provedores")}: {run.calls}/
              {run.budget.maxCalls} ·{" "}
              {t("Reserved budget", "Orçamento reservado")}:{" "}
              {currency.format(run.costMicros / 1_000_000)}/
              {currency.format(run.budget.maxCostMicros / 1_000_000)}
            </p>
            {run.status === "waiting_approval" && (
              <p className="text-sm leading-6 text-slate-300">
                {t(
                  "Continue with additional model requests on the bundled public examples? The server enforces the displayed spending cap. Reservations are conservative estimates, not your provider invoice.",
                  "Continuar com chamadas adicionais aos modelos usando os exemplos públicos do projeto? O servidor aplica o limite de gasto exibido. As reservas são estimativas conservadoras, não a fatura do provedor.",
                )}
              </p>
            )}
            {run.errorCode && (
              <p className="text-sm text-rose-200">
                {run.errorCode === "budget_exceeded"
                  ? t(
                      "The execution reached its configured budget.",
                      "A execução atingiu o orçamento configurado.",
                    )
                  : run.errorCode === "deadline_exceeded"
                    ? t(
                        "The execution reached its time limit.",
                        "A execução atingiu o limite de tempo.",
                      )
                    : t(
                        "The execution stopped safely. Review the workspace configuration before starting again.",
                        "A execução foi interrompida com segurança. Confira a configuração do espaço antes de tentar novamente.",
                      )}
              </p>
            )}
            {active && (
              <div className="flex flex-wrap gap-2">
                {run.status === "waiting_approval" && (
                  <button
                    type="button"
                    className="primary-button"
                    disabled={action.isPending}
                    onClick={() =>
                      action.mutate({ runId: run.runId, action: "approve" })
                    }
                  >
                    {t("Approve and continue", "Aprovar e continuar")}
                  </button>
                )}
                <button
                  type="button"
                  className="secondary-button"
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({ runId: run.runId, action: "cancel" })
                  }
                >
                  {t("Cancel evaluation", "Cancelar avaliação")}
                </button>
              </div>
            )}
          </article>
        );
      })}
      {action.isError && (
        <p role="alert" className="error-message py-3">
          {workspaceRequestError(
            action.error,
            t,
            t(
              "Could not update this evaluation. Refresh and try again.",
              "Não foi possível atualizar a avaliação. Atualize a página e tente novamente.",
            ),
          )}
        </p>
      )}
    </section>
  );
}
