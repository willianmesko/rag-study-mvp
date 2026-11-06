import type { SearchResult } from "../api/rag-api";

function Score({ value }: { value: number }) {
  const score = Math.max(0, Math.min(1, value));
  return <div className="flex min-w-28 flex-col items-end gap-1" title="Similarity score, not factual certainty"><span className="font-mono text-sm font-semibold text-cyan-300">{score.toFixed(3)}</span><div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-cyan-400" style={{ width: `${score * 100}%` }} /></div><span className="text-[10px] uppercase tracking-[0.12em] text-slate-500">similarity</span></div>;
}

export function SearchResultCard({ result, index }: { result: SearchResult; index: number }) {
  const risk = result.security.promptInjectionRisk;
  const riskStyle = risk === "high" ? "text-rose-300" : risk === "medium" ? "text-amber-300" : "text-emerald-300";
  return <article className="group rounded-2xl border border-slate-800 bg-slate-950/60 p-5 transition duration-200 hover:-translate-y-0.5 hover:border-cyan-500/40"><div className="flex gap-4"><span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-cyan-400/10 font-mono text-xs font-semibold text-cyan-300">{String(index + 1).padStart(2, "0")}</span><div className="min-w-0 flex-1 space-y-3"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-slate-100">{result.title ?? result.source}</p><p className="mt-1 truncate font-mono text-xs text-slate-500">{result.source} · chunk {result.ordinal}</p><p className={`mt-1 text-xs font-medium ${riskStyle}`}>Instruction risk: {risk}</p>{result.retrieval && <p className="mt-1 font-mono text-xs text-slate-500">RRF {result.retrieval.fusionScore.toFixed(4)} · vector #{result.retrieval.vectorRank ?? "–"} · keyword #{result.retrieval.keywordRank ?? "–"}</p>}{result.reranker && <p className="mt-1 font-mono text-xs text-violet-300">Reranker #{result.reranker.rank} · relevance {result.reranker.score.toFixed(3)}</p>}</div><Score value={result.score} /></div><p className="text-sm leading-6 text-slate-300">{result.content}</p></div></div></article>;
}
