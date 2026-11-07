import { WorkspaceUsage } from "../../../features/workspace-usage/index";
import { useLocale } from "../../../shared/i18n/locale";
import { WorkspacePageHeader } from "./WorkspacePageHeader";

export function WorkspaceUsagePage({
  workspaceId,
  token,
}: {
  workspaceId: string;
  token: string;
}) {
  const { t } = useLocale();
  return (
    <div className="space-y-6">
      <WorkspacePageHeader
        title={t("Usage & costs", "Uso e custos")}
        description={t(
          "Understand your workspace's AI activity and recorded costs.",
          "Acompanhe a atividade de IA e os custos registrados do seu espaço.",
        )}
      />
      <WorkspaceUsage workspaceId={workspaceId} token={token} />
    </div>
  );
}
