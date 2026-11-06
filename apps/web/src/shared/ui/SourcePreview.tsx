import type { QuestionSource } from "../api/rag-api";

export function SourcePreview({ source, onClose }: { source: QuestionSource; onClose: () => void }) {
  return <section className="panel animate-fade-up mt-6 border-violet-400/20 bg-violet-400/[0.05]" aria-label="Cited source"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow text-violet-300">Cited source</p><p className="mt-2 text-sm font-medium text-slate-100">{source.title ?? source.source} · chunk {source.chunk}</p></div><button type="button" className="secondary-button min-h-8 px-3 py-1 text-xs" onClick={onClose}>Close</button></div><p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-300">{source.excerpt}</p></section>;
}
