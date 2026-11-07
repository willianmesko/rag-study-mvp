import type { Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { Mascot } from "../../../shared/ui/Mascot";
import { WorkspaceSwitcher, type WorkspaceCreation } from "./WorkspaceSwitcher";

export function LabHeader({ online, loading, publicDemo, workspaces, workspaceId, onWorkspaceChange, workspaceCreation, accountAction, compact = false }: {
  online: boolean;
  loading: boolean;
  publicDemo: boolean;
  workspaces: Workspace[];
  workspaceId: string;
  onWorkspaceChange: (workspaceId: string) => void;
  workspaceCreation?: WorkspaceCreation;
  accountAction: { label: string; onClick: () => void; disabled?: boolean };
  compact?: boolean;
}) {
  const { t } = useLocale();
  const status = loading ? t("Connecting…", "Conectando…") : online
    ? t("Connected", "Conectado")
    : t("Could not connect", "Sem conexão com o Lumora");

  return (
    <header className={compact ? "flex min-w-0 justify-end" : "flex flex-col gap-6 border-b border-slate-800/80 pb-8 2xl:flex-row 2xl:items-end 2xl:justify-between"}>
      {!compact && <div className="flex min-w-0 items-start gap-4">
        <Mascot size="sm" className="hidden shrink-0 sm:block" decorative />
        <div>
          <div className="flex items-center gap-2">
            <span className="status-dot" aria-hidden="true" />
            <p className="eyebrow">{publicDemo ? t("Knowledge workspace demo", "Demonstração do Lumora") : t("Private knowledge workspace", "Conhecimento da sua equipe")}</p>
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {publicDemo
              ? t("Try Lumora with sample documents.", "Experimente o Lumora com documentos de exemplo.")
              : t("Answers from your team’s documents", "Respostas com base nos documentos da equipe")}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
            {publicDemo
              ? t("Search the sample library or ask a question and check the sources.", "Busque na biblioteca de exemplo ou faça uma pergunta e confira as fontes.")
              : t("Find a passage or ask a question, then open the sources behind the answer.",
                  "Encontre um trecho ou faça uma pergunta. Depois, confira as fontes da resposta.")}
          </p>
        </div>
      </div>}
      <div className={`flex min-w-0 flex-wrap items-end 2xl:shrink-0 ${compact ? "justify-end gap-2 sm:gap-3" : "gap-3"}`}>
        <WorkspaceSwitcher workspaces={workspaces} selectedId={workspaceId} onChange={onWorkspaceChange} creation={workspaceCreation} compact={compact} />
        <div role="status" className={`status-pill mb-1.5 ${online ? "status-pill--success" : loading ? "" : "status-pill--warning"}`}>
          <span aria-hidden="true" className={`size-1.5 rounded-full ${online ? "bg-emerald-400" : "bg-amber-400"}`} />
          {status}
        </div>
        <button className="secondary-button min-h-11" type="button" disabled={accountAction.disabled} onClick={accountAction.onClick}>
          {accountAction.label}
        </button>
      </div>
    </header>
  );
}
