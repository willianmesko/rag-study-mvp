import { useQuery } from "@tanstack/react-query";
import { WorkspaceChatPolicy } from "../../../features/workspace-model-policy/ui/WorkspaceChatPolicy";
import { WorkspaceMcpConnection } from "../../../features/workspace-mcp/ui/WorkspaceMcpConnection";
import type { Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { workspaceRoleLabel } from "../model/labels";
import { usageQuery } from "../model/queries";
import { WorkspaceQueryFeedback } from "./WorkspaceQueryFeedback";

export function WorkspaceSettings({ workspace, token }: { workspace: Workspace; token: string }) {
  const { locale, t } = useLocale();
  const number = new Intl.NumberFormat(locale);
  const currency = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const usage = useQuery(usageQuery(token, workspace.tenantId));
  const summary = usage.data?.summary;
  const metrics = summary ? [
    [t("Requests", "Solicitações"), number.format(summary.requests)],
    [t("Cache hits", "Respostas reutilizadas"), number.format(summary.cacheHits)],
    [t("Average latency", "Latência média"), `${number.format(Math.round(summary.averageLatencyMs))} ms`],
    [t("Provider failures", "Falhas do provedor"), number.format(summary.providerFailures)]
  ] : [];

  return (
    <div className="space-y-5">
      <section className="panel">
        <p className="eyebrow">{t("Workspace profile", "Perfil do espaço")}</p>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          {[
            [t("Name", "Nome"), workspace.tenantName],
            [t("Workspace URL", "Endereço do espaço"), workspace.tenantSlug],
            [t("Your role", "Seu perfil"), workspaceRoleLabel(workspace.role, t)],
            [t("Data access", "Acesso aos dados"), t("Isolated to this workspace", "Restrito a este espaço")]
          ].map(([label, value]) => (
            <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/45 p-4" key={label}>
              <dt className="text-xs text-slate-400">{label}</dt>
              <dd className="mt-2 break-words text-sm text-slate-100">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <WorkspaceChatPolicy token={token} workspaceId={workspace.tenantId} />
      <WorkspaceMcpConnection key={workspace.tenantId} token={token} workspaceId={workspace.tenantId} />
      <WorkspaceQueryFeedback query={usage} loading={t("Loading usage…", "Carregando o uso…")}
        failure={t("We could not load usage.", "Não foi possível carregar os dados de uso.")} />
      {usage.data && (
        <section className="panel">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="eyebrow">{t("AI usage · last 30 days", "Uso de IA · últimos 30 dias")}</p>
              <p className="mt-2 text-sm text-slate-400">{t("Costs are estimates based on the configured model prices.", "Os custos são estimados com base nos preços configurados para o modelo.")}</p>
            </div>
            <span className={"font-mono text-sm " + (usage.data.alert.triggered ? "text-rose-300" : "text-cyan-300")}>{currency.format(usage.data.summary.estimatedCostUsd)}</span>
          </div>
          {usage.data.alert.triggered && <p className="mt-4 rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">{t("Estimated usage reached the budget alert of", "O uso estimado atingiu o limite de alerta de")} {currency.format(usage.data.alert.thresholdUsd)}.</p>}
          <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {metrics.map(([label, value]) => <div key={label} className="workspace-metric"><dt className="text-xs text-slate-400">{label}</dt><dd className="mt-1 font-mono text-sm text-slate-100">{value}</dd></div>)}
          </dl>
        </section>
      )}
    </div>
  );
}
