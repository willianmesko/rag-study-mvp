import type { QuestionSource } from "../api/rag-api";

export function SourcePreview({ source, onClose }: { source: QuestionSource; onClose: () => void }) {
  return <section className="mt-6 rounded-2xl border border-violet-400/20 bg-violet-400/5 p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold tracking-[0.14em] text-violet-300 uppercase">Cited source</p><p className="mt-2 text-sm font-medium text-slate-100">{source.title ?? source.source} · chunk {source.chunk}</p></div><button type="button" className="text-xs text-slate-400 hover:text-white" onClick={onClose}>Close</button></div><p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-300">{source.excerpt}</p></section>;
}
