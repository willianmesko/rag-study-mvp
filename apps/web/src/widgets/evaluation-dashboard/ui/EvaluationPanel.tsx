import type { EvaluationRun } from "../../../shared/api/rag-api";

function percentage(value: number | null) {
  return value === null ? "Not connected" : `${Math.round(value * 100)}%`;
}

function metricTone(value: number | null, threshold: number) {
  if (value === null) return "text-slate-500";
  return value >= threshold ? "text-emerald-300" : "text-rose-300";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export function EvaluationPanel({ runs, isLoading, isRunning, onRun }: { runs: EvaluationRun[]; isLoading: boolean; isRunning: boolean; onRun: () => void }) {
  const latest = runs[0];
  return <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="eyebrow">Evaluation harness</p>
        <h3 className="mt-2 font-medium">RAG quality dashboard</h3>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">Golden-set retrieval and prompt-injection checks are deterministic. Faithfulness and context precision will appear after an LLM judge or Ragas evaluator is connected.</p>
      </div>
      <button className="primary-button" type="button" onClick={onRun} disabled={isRunning}>{isRunning ? "Running…" : "Run evaluation"}</button>
    </div>
    {isLoading && <div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="skeleton h-20" /><div className="skeleton h-20" /><div className="skeleton h-20" /></div>}
    {!isLoading && latest && <>
      <div className="mt-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Metric label="Hit rate" value={percentage(latest.hitRate)} tone={metricTone(latest.hitRate, 0.8)} />
        <Metric label="MRR" value={percentage(latest.meanReciprocalRank)} tone={metricTone(latest.meanReciprocalRank, 0.7)} />
        <Metric label="Faithfulness" value={percentage(latest.faithfulness)} tone="text-slate-500" />
        <Metric label="Context precision" value={percentage(latest.contextPrecision)} tone="text-slate-500" />
        <Metric label="Injection pass" value={percentage(latest.injectionPassRate)} tone={metricTone(latest.injectionPassRate, 1)} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500"><span className={`status-pill ${latest.passed ? "status-pill--success" : "border-rose-400/30 bg-rose-400/10 text-rose-300"}`}>{latest.passed ? "Passed" : "Failed"}</span><span>{latest.datasetName} v{latest.datasetVersion}</span><span>{latest.totalCases} cases</span><span>{latest.durationMs} ms</span><span>{formatDate(latest.createdAt)}</span></div>
    </>}
    {!isLoading && runs.length === 0 && <p className="empty-state mt-5">No evaluation runs yet. Upload the golden corpus with source <span className="font-mono">golden/rag-fundamentals</span> before running the retrieval evaluation.</p>}
    {!isLoading && runs.length > 0 && <div className="mt-6 overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="border-b border-slate-800 text-slate-500"><tr><th className="px-3 py-2 font-medium">Run</th><th className="px-3 py-2 font-medium">Hit rate</th><th className="px-3 py-2 font-medium">MRR</th><th className="px-3 py-2 font-medium">Injection</th><th className="px-3 py-2 font-medium">Judge metrics</th><th className="px-3 py-2 font-medium">Status</th></tr></thead><tbody>{runs.map((run) => <tr className="border-b border-slate-900" key={run.id}><td className="px-3 py-3"><p className="text-slate-300">{formatDate(run.createdAt)}</p><p className="mt-1 font-mono text-[10px] text-slate-600">{run.commitSha?.slice(0, 7) ?? "local"}</p></td><td className={`px-3 py-3 font-mono ${metricTone(run.hitRate, 0.8)}`}>{percentage(run.hitRate)}</td><td className={`px-3 py-3 font-mono ${metricTone(run.meanReciprocalRank, 0.7)}`}>{percentage(run.meanReciprocalRank)}</td><td className={`px-3 py-3 font-mono ${metricTone(run.injectionPassRate, 1)}`}>{percentage(run.injectionPassRate)}</td><td className="px-3 py-3 text-slate-500">{run.faithfulness === null && run.contextPrecision === null ? "Pending judge" : `${percentage(run.faithfulness)} / ${percentage(run.contextPrecision)}`}</td><td className="px-3 py-3">{run.passed ? <span className="text-emerald-300">Passed</span> : <span className="text-rose-300">Failed</span>}</td></tr>)}</tbody></table></div>}
  </section>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><p className="text-[11px] text-slate-500">{label}</p><p className={`mt-2 font-mono text-lg ${tone}`}>{value}</p></div>;
}
