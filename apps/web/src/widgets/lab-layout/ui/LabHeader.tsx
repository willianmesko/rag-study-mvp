import type { Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { Mascot } from "../../../shared/ui/Mascot";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export function LabHeader({ online, loading, publicDemo, workspaces, workspaceId, onWorkspaceChange, accountAction }: {
  online: boolean;
  loading: boolean;
  publicDemo: boolean;
  workspaces: Workspace[];
  workspaceId: string;
  onWorkspaceChange: (workspaceId: string) => void;
  accountAction: { label: string; onClick: () => void; disabled?: boolean };
}) {
  const { t } = useLocale();
  const status = loading ? t("Connecting", "Conectando") : online
    ? t("All systems ready", "Tudo pronto")
    : t("Connection unavailable", "Conexão indisponível");

  return (
    <header className="flex flex-col gap-6 border-b border-slate-800/80 pb-8 2xl:flex-row 2xl:items-end 2xl:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        <Mascot size="sm" className="hidden shrink-0 sm:block" decorative />
        <div>
          <div className="flex items-center gap-2">
            <span className="status-dot" aria-hidden="true" />
            <p className="eyebrow">{publicDemo ? t("Knowledge workspace demo", "Demonstração do Lumora") : t("Private knowledge workspace", "Conhecimento da sua equipe")}</p>
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {publicDemo
              ? t("Try Lumora with sample documents.", "Experimente o Lumora com documentos de exemplo.")
              : t("Ask your workspace anything.", "Pergunte aos documentos da sua equipe.")}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
            {publicDemo
              ? t("Explore how Lumora searches and answers using the public library.", "Veja como o Lumora busca e responde usando a biblioteca pública.")
              : t("Lumora uses your documents to answer questions and show where each answer comes from.",
                  "O Lumora consulta seus documentos para responder e mostrar de onde vêm as informações.")}
          </p>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-end gap-3 2xl:shrink-0">
        <WorkspaceSwitcher workspaces={workspaces} selectedId={workspaceId} onChange={onWorkspaceChange} />
        <div className={`status-pill mb-1.5 ${online ? "status-pill--success" : "status-pill--warning"}`}>
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
