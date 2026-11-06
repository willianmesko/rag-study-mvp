export type LabTab = "ingest" | "search" | "answer" | "history" | "admin";

const tabs: Array<{ id: LabTab; label: string; number: string }> = [
  { id: "ingest", label: "Index", number: "01" },
  { id: "search", label: "Retrieve", number: "02" },
  { id: "answer", label: "Ask", number: "03" },
  { id: "history", label: "History", number: "04" },
  { id: "admin", label: "Workspace", number: "05" }
];

export function LabNavigation({ activeTab, onTabChange, publicDemo }: { activeTab: LabTab; onTabChange: (tab: LabTab) => void; publicDemo: boolean }) {
  const visibleTabs = publicDemo ? tabs.filter((tab) => tab.id !== "ingest") : tabs;
  return <aside className="relative z-10 border-b border-slate-800/80 bg-slate-950/65 p-5 backdrop-blur-xl lg:border-r lg:border-b-0 lg:p-6"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-2xl bg-cyan-400 text-lg font-black text-slate-950 shadow-lg shadow-cyan-950/30">R</div><div><p className="font-semibold tracking-tight text-slate-50">RAG Lab</p><p className="text-xs text-slate-500">{publicDemo ? "Public demo" : "Visual study"}</p></div></div><nav className="mt-7 flex gap-2 overflow-x-auto pb-1 lg:mt-10 lg:grid lg:overflow-visible" aria-label="Lab steps">{visibleTabs.map((tab) => <button key={tab.id} type="button" onClick={() => onTabChange(tab.id)} aria-current={activeTab === tab.id ? "page" : undefined} className={`group flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition duration-200 lg:py-3 ${activeTab === tab.id ? "bg-cyan-400/10 text-cyan-100 shadow-inner shadow-cyan-400/5" : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"}`}><span className={`font-mono text-[11px] ${activeTab === tab.id ? "text-cyan-300" : "text-slate-600 group-hover:text-slate-400"}`}>{tab.number}</span><span className="font-medium">{tab.label}</span></button>)}</nav><div className="mt-7 hidden rounded-2xl border border-slate-800 bg-slate-900/50 p-4 text-xs leading-5 text-slate-400 lg:block"><p className="font-medium text-slate-300">Pipeline</p><p className="mt-2 font-mono text-[11px] text-slate-500">text → chunks → vectors → search → context</p></div></aside>;
}
