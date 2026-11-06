export type LabTab = "ingest" | "search" | "answer" | "history" | "admin";

const tabs: Array<{ id: LabTab; label: string; number: string }> = [
  { id: "ingest", label: "Indexar", number: "01" },
  { id: "search", label: "Buscar", number: "02" },
  { id: "answer", label: "Responder", number: "03" },
  { id: "history", label: "Histórico", number: "04" },
  { id: "admin", label: "Administrar", number: "05" }
];

export function LabNavigation({ activeTab, onTabChange, publicDemo }: { activeTab: LabTab; onTabChange: (tab: LabTab) => void; publicDemo: boolean }) {
  const visibleTabs = publicDemo ? tabs.filter((tab) => tab.id !== "ingest") : tabs;
  return <aside className="border-b border-slate-800 bg-slate-950/80 p-6 backdrop-blur lg:border-r lg:border-b-0"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-cyan-400 text-lg font-black text-slate-950">R</div><div><p className="font-semibold tracking-tight text-slate-50">RAG Lab</p><p className="text-xs text-slate-500">{publicDemo ? "Demo pública" : "Estudo visual"}</p></div></div><nav className="mt-10 grid gap-2" aria-label="Etapas do laboratório">{visibleTabs.map((tab) => <button key={tab.id} type="button" onClick={() => onTabChange(tab.id)} className={`flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm transition ${activeTab === tab.id ? "bg-cyan-400/10 text-cyan-200" : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"}`}><span className="font-mono text-xs text-slate-500">{tab.number}</span><span className="font-medium">{tab.label}</span></button>)}</nav><div className="mt-10 rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-xs leading-5 text-slate-400"><p className="font-medium text-slate-300">Pipeline</p><p className="mt-2 font-mono text-[11px] text-slate-500">texto → chunks → vetores → busca → contexto</p></div></aside>;
}
