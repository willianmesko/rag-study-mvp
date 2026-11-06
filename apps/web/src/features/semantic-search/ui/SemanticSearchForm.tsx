import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../../shared/api/rag-api";
import { getRequestErrorMessage } from "../../../shared/lib/request-error";
import { searchInputSchema } from "@rag-study/contracts";
import { InputLabel } from "../../../shared/ui/InputLabel";
import { SearchResultCard } from "../../../shared/ui/SearchResultCard";
import { SectionTitle } from "../../../shared/ui/SectionTitle";

export function SemanticSearchForm() {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(5);
  const [validationError, setValidationError] = useState<string | null>(null);
  const search = useMutation({ mutationFn: api.search });
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); try { setValidationError(null); search.mutate(searchInputSchema.parse({ query, topK })); } catch (error) { setValidationError(error instanceof Error ? error.message : "Invalid input."); } }
  const error = validationError ?? (search.error ? getRequestErrorMessage(search.error) : null);
  return <form className="space-y-7" onSubmit={submit}><SectionTitle eyebrow="Step 02" title="Run a semantic search">The query also becomes a vector. The database combines vector and keyword search to find the most related chunks.</SectionTitle><div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6"><InputLabel label="What do you want to find?"><textarea value={query} onChange={(event) => setQuery(event.target.value)} className="field min-h-28 resize-y" placeholder="How do embeddings represent the meaning of text?" /></InputLabel><div className="mt-5 flex flex-wrap items-end justify-between gap-5"><InputLabel label="Chunk count"><select value={topK} onChange={(event) => setTopK(Number(event.target.value))} className="field w-36">{[3, 5, 8, 10].map((value) => <option key={value} value={value}>top {value}</option>)}</select></InputLabel><button className="primary-button" disabled={search.isPending} type="submit">{search.isPending ? "Searching…" : "Search chunks"}</button></div></div>{search.data && <div className="space-y-3"><p className="text-sm text-slate-400">{search.data.results.length} chunks returned, ranked by relevance.</p>{search.data.results.map((result, index) => <SearchResultCard key={result.chunkId} result={result} index={index} />)}</div>}{error && !search.isPending && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{error}</p>}</form>;
}
