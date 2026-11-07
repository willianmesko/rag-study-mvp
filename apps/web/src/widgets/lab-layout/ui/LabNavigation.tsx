import type { ReactNode } from "react";
import { useLocale } from "../../../shared/i18n/locale";
import { BrandMark } from "../../../shared/ui/BrandMark";
import type { LabRoute } from "../../../shared/lib/app-route";

const tabs = [
  ["answer", "Ask", "Perguntar", "M5 4h14v10H9l-4 4V4Z"],
  ["search", "Search", "Buscar", "M15 15l5 5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"],
  ["history", "History", "Histórico", "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"],
  ["admin", "Workspace", "Espaço de trabalho", "M4 5h6v6H4V5Zm10 0h6v6h-6V5ZM4 15h6v6H4v-6Zm10 0h6v6h-6v-6Z"],
  ["ingest", "Add documents", "Adicionar documentos", "M12 5v14M5 12h14"]
] as const;

export function LabNavigation({ activeTab, onTabChange, publicDemo, canIndex, workspaceControl, onHelp }: {
  activeTab: LabRoute["tab"];
  onTabChange: (tab: LabRoute["tab"]) => void;
  publicDemo: boolean;
  canIndex: boolean;
  workspaceControl?: ReactNode;
  onHelp?: () => void;
}) {
  const { t } = useLocale();
  const visibleTabs = tabs.filter(([id]) => (id !== "ingest" || canIndex) && (id !== "admin" || !publicDemo));
  const compact = activeTab === "answer";

  return (
    <aside className={`relative z-10 border-b border-slate-800/80 bg-slate-950/65 backdrop-blur-xl lg:border-r lg:border-b-0 lg:p-6 ${compact ? "px-3 py-2 sm:p-5" : "p-5"}`}>
      <div className={`items-center gap-3 ${compact ? "hidden sm:flex" : "flex"}`}>
        <BrandMark />
        <div>
          <p className="font-semibold tracking-tight text-slate-50">Lumora</p>
          <p className="text-xs text-slate-400">{t("Team knowledge", "Conhecimento da equipe")}</p>
        </div>
      </div>
      {workspaceControl && <div className={compact ? "sm:mt-5" : "mt-5"}>{workspaceControl}</div>}
      <nav className={`flex gap-2 overflow-x-auto p-1.5 lg:mt-10 lg:grid lg:overflow-visible ${compact ? "sm:mt-7" : "mt-7"}`}
        aria-label={t("Main navigation", "Navegação principal")}>
        {visibleTabs.map(([id, english, portuguese, icon]) => (
          <button key={id} type="button" onClick={() => onTabChange(id)} aria-current={activeTab === id ? "page" : undefined}
            className={`group flex min-h-11 shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors lg:py-3 ${activeTab === id ? "bg-cyan-400/10 text-cyan-100 shadow-inner shadow-cyan-400/5 hover:bg-cyan-400/15" : "text-slate-300 hover:bg-slate-800 hover:text-slate-100"}`}>
            <svg aria-hidden="true" className={`size-4 shrink-0 ${activeTab === id ? "text-cyan-300" : "text-slate-400"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={icon} /></svg>
            <span className="font-medium">{t(english, portuguese)}</span>
          </button>
        ))}
        {onHelp && <button type="button" onClick={onHelp} aria-haspopup="dialog"
          className="flex min-h-11 shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100 lg:py-3">
          <svg aria-hidden="true" className="size-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.5-2.5 2-2.5 3.5m0 3h.01" /></svg>
          <span className="font-medium">{t("Help", "Ajuda")}</span>
        </button>}
      </nav>
      <div className="mt-7 hidden rounded-2xl border border-slate-800 bg-slate-900/50 p-4 text-xs leading-5 text-slate-400 lg:block">
        <p className="font-medium text-slate-300">{t("How Lumora works", "Como o Lumora funciona")}</p>
        <p className="mt-2">{t("Documents → search → answers with sources", "Documentos → busca → respostas com fontes")}</p>
      </div>
    </aside>
  );
}
