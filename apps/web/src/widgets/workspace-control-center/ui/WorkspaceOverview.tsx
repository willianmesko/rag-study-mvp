import type { EvaluationRun, ManagedDocument, UploadJob, UsageSummary, Workspace } from "../../../shared/api/rag-api";
import type { WorkspaceSection } from "../../../shared/lib/app-route";

function Metric({ label, value, hint, tone = "default" }: { label: string; value: string | number; hint: string; tone?: "default" | "cyan" | "emerald" | "amber" }) {
  return <article className={`workspace-metric workspace-metric--${tone}`}><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight text-slate-100">{value}</p><p className="mt-2 text-[11px] leading-5 text-slate-500">{hint}</p></article>;
}

export function WorkspaceOverview({ workspace, documents, jobs, usage, evaluations, onNavigate }: { workspace?: Workspace; documents: ManagedDocument[]; jobs: UploadJob[]; usage?: UsageSummary; evaluations: EvaluationRun[]; onNavigate: (section: WorkspaceSection) => void }) {
  const activeJobs = jobs.filter((job) => job.status === "queued" || job.status === "processing").length;
  const completedJobs = jobs.filter((job) => job.status === "completed").length;
  const failedJobs = jobs.filter((job) => job.status === "failed").length;
  return <div className="space-y-6 animate-fade-up">
    <div className="workspace-hero panel"><div><p className="eyebrow">Workspace pulse</p><h3 className="mt-2 text-2xl font-semibold text-white">{workspace?.tenantName ?? "Your knowledge workspace"}</h3><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">A calm place to keep your team’s knowledge, processing jobs, and answer quality in view.</p></div><span className="status-pill status-pill--success">{workspace?.role ?? "member"}</span></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Knowledge sources" value={documents.length} hint="Indexed documents available to retrieval" tone="cyan" /><Metric label="Active processing" value={activeJobs} hint={failedJobs ? `${failedJobs} job${failedJobs === 1 ? "" : "s"} need attention` : "Everything is moving cleanly"} tone={failedJobs ? "amber" : "emerald"} /><Metric label="Completed jobs" value={completedJobs} hint="Successful ingestion runs in this workspace" /><Metric label="Questions · 30 days" value={usage?.requests ?? "—"} hint={usage ? `${Math.round(usage.averageLatencyMs)} ms average latency` : "Owner usage metrics"} /></div>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]"><section className="panel"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Next best actions</p><h3 className="mt-2 text-lg font-semibold text-white">Keep the workspace useful</h3></div><span className="text-xs text-slate-500">{documents.length > 0 ? "Knowledge is ready" : "Start here"}</span></div><div className="mt-5 grid gap-3 sm:grid-cols-2">{[
      ["knowledge", "Add trusted material", "Upload policies, playbooks, decisions, or case notes."],
      ["processing", "Review processing", "See what Lumora is extracting and indexing."],
      ["team", "Invite your team", "Give people the least access they need."],
      ["evaluations", "Check answer quality", "Run the golden set before sharing the workspace."]
    ].map(([section, title, description]) => <button key={section} type="button" className="workspace-action-card" onClick={() => onNavigate(section as WorkspaceSection)}><span className="text-sm font-medium text-slate-100">{title}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span><span className="mt-3 block text-xs font-semibold text-cyan-300">View details →</span></button>)}</div></section><aside className="panel"><p className="eyebrow">Quality snapshot</p><div className="mt-4 space-y-4"><div><p className="text-xs text-slate-500">Evaluation runs</p><p className="mt-1 text-xl font-semibold text-slate-100">{evaluations.length}</p></div><div><p className="text-xs text-slate-500">Latest status</p><p className="mt-1 text-sm text-slate-200">{evaluations[0]?.passed ? "All gates passed" : evaluations.length ? "Review latest run" : "Not evaluated yet"}</p></div><button type="button" className="secondary-button w-full" onClick={() => onNavigate("evaluations")}>Open evaluations</button></div></aside></div>
    <p className="text-xs leading-5 text-slate-500">A similarity score tells you how closely a chunk matches the question. It is not a guarantee that the answer is factually correct.</p>
  </div>;
}
