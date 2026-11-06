import { useLocale } from "../../../shared/i18n/locale";
import { BrandMark } from "../../../shared/ui/BrandMark";

export type LabTab = "ingest" | "search" | "answer" | "history" | "admin";

const tabs = [
  ["ingest", "Index", "Indexar", "01"],
  ["search", "Search", "Buscar", "02"],
  ["answer", "Ask", "Perguntar", "03"],
  ["history", "History", "Histórico", "04"],
  ["admin", "Workspace", "Espaço de trabalho", "05"]
] as const;

export function LabNavigation({ activeTab, onTabChange, publicDemo }: { activeTab: LabTab; onTabChange: (tab: LabTab) => void; publicDemo: boolean }) {
  const { t } = useLocale();
  const visibleTabs = publicDemo ? tabs.filter(([id]) => id !== "ingest") : tabs;

  return (
    <aside className="relative z-10 border-b border-slate-800/80 bg-slate-950/65 p-5 backdrop-blur-xl lg:border-r lg:border-b-0 lg:p-6">
      <div className="flex items-center gap-3">
        <BrandMark />
        <div>
          <p className="font-semibold tracking-tight text-slate-50">Lumora</p>
          <p className="text-xs text-slate-400">{t("Team knowledge", "Conhecimento da equipe")}</p>
        </div>
      </div>
      <nav className="mt-7 flex gap-2 overflow-x-auto pb-1 lg:mt-10 lg:grid lg:overflow-visible" aria-label={t("Main navigation", "Navegação principal")}>
        {visibleTabs.map(([id, english, portuguese, number]) => (
          <button key={id} type="button" onClick={() => onTabChange(id)} aria-current={activeTab === id ? "page" : undefined}
            className={`group flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition duration-200 lg:py-3 ${activeTab === id ? "bg-cyan-400/10 text-cyan-100 shadow-inner shadow-cyan-400/5" : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"}`}>
            <span aria-hidden="true" className={`font-mono text-[11px] ${activeTab === id ? "text-cyan-300" : "text-slate-500 group-hover:text-slate-400"}`}>{number}</span>
            <span className="font-medium">{t(english, portuguese)}</span>
          </button>
        ))}
      </nav>
      <div className="mt-7 hidden rounded-2xl border border-slate-800 bg-slate-900/50 p-4 text-xs leading-5 text-slate-400 lg:block">
        <p className="font-medium text-slate-300">{t("How Lumora works", "Como o Lumora funciona")}</p>
        <p className="mt-2">{t("Documents → search → answers with sources", "Documentos → busca → respostas com fontes")}</p>
      </div>
    </aside>
  );
}
