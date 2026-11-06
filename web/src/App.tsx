import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, ApiError, type SearchResult } from "./lib/api";
import { documentInputSchema, questionInputSchema, searchInputSchema } from "./lib/schemas";

type Tab = "ingest" | "search" | "answer";

const tabs: Array<{ id: Tab; label: string; number: string }> = [
  { id: "ingest", label: "Indexar", number: "01" },
  { id: "search", label: "Buscar", number: "02" },
  { id: "answer", label: "Responder", number: "03" }
];
const isPublicDemo = import.meta.env.VITE_DEMO_MODE === "true";
const visibleTabs = isPublicDemo ? tabs.filter((tab) => tab.id !== "ingest") : tabs;

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 500) {
    return "O backend respondeu com erro. Isso é esperado até configurarmos o provedor local de embeddings.";
  }
  return error instanceof Error ? error.message : "Ocorreu um erro inesperado.";
}

function SectionTitle({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold tracking-[0.18em] text-cyan-300 uppercase">{eyebrow}</p>
      <h2 className="text-2xl font-semibold tracking-tight text-slate-50">{title}</h2>
      <p className="max-w-2xl text-sm leading-6 text-slate-400">{children}</p>
    </div>
  );
}

function InputLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2 text-sm font-medium text-slate-300">
      {label}
      {children}
    </label>
  );
}

function Score({ value }: { value: number }) {
  const score = Math.max(0, Math.min(1, value));
  return (
    <div className="flex min-w-28 flex-col items-end gap-1">
      <span className="font-mono text-sm font-semibold text-cyan-300">{score.toFixed(3)}</span>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-cyan-400" style={{ width: `${score * 100}%` }} />
      </div>
    </div>
  );
}

function ResultCard({ result, index }: { result: SearchResult; index: number }) {
  const risk = result.security.promptInjectionRisk;
  const riskStyle = risk === "high" ? "text-rose-300" : risk === "medium" ? "text-amber-300" : "text-emerald-300";
  return (
    <article className="rounded-xl border border-slate-800 bg-slate-950/70 p-5 transition hover:border-cyan-500/40">
      <div className="flex gap-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-cyan-400/10 font-mono text-xs font-semibold text-cyan-300">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-100">{result.title ?? result.source}</p>
              <p className="mt-1 truncate font-mono text-xs text-slate-500">{result.source} · chunk {result.ordinal}</p>
              <p className={`mt-1 text-xs font-medium ${riskStyle}`}>Risco de instrução: {risk}</p>
              {result.retrieval && <p className="mt-1 font-mono text-xs text-slate-500">RRF {result.retrieval.fusionScore.toFixed(4)} · vetor #{result.retrieval.vectorRank ?? "–"} · texto #{result.retrieval.keywordRank ?? "–"}</p>}
              {result.reranker && <p className="mt-1 font-mono text-xs text-violet-300">Reranker #{result.reranker.rank} · relevância {result.reranker.score.toFixed(3)}</p>}
            </div>
            <Score value={result.score} />
          </div>
          <p className="text-sm leading-6 text-slate-300">{result.content}</p>
        </div>
      </div>
    </article>
  );
}

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>(isPublicDemo ? "search" : "ingest");
  const [source, setSource] = useState("notes/primeiro-documento");
  const [title, setTitle] = useState("Minhas notas de RAG");
  const [text, setText] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [question, setQuestion] = useState("");
  const [topK, setTopK] = useState(5);
  const [validationError, setValidationError] = useState<string | null>(null);

  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 30_000 });
  const ingest = useMutation({ mutationFn: api.ingest });
  const search = useMutation({ mutationFn: api.search });
  const answer = useMutation({ mutationFn: api.answer });

  function validate<T>(parse: () => T): T | null {
    try {
      setValidationError(null);
      return parse();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dados inválidos.";
      setValidationError(message);
      return null;
    }
  }

  function submitIngest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = validate(() => documentInputSchema.parse({ source, title: title || undefined, text, metadata: {} }));
    if (parsed) ingest.mutate(parsed);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = validate(() => searchInputSchema.parse({ query: searchTerm, topK }));
    if (parsed) search.mutate(parsed);
  }

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = validate(() => questionInputSchema.parse({ question, topK }));
    if (parsed) answer.mutate(parsed);
  }

  const apiOnline = health.data?.status === "ok";
  const requestError = ingest.error ?? search.error ?? answer.error;
  const currentError = validationError ?? (requestError ? getErrorMessage(requestError) : null);
  const isLoading = ingest.isPending || search.isPending || answer.isPending;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(34,211,238,0.12),transparent_28rem),radial-gradient(circle_at_90%_15%,rgba(59,130,246,0.1),transparent_24rem)]" />
      <div className="relative mx-auto grid min-h-screen max-w-7xl lg:grid-cols-[17rem_1fr]">
        <aside className="border-b border-slate-800 bg-slate-950/80 p-6 backdrop-blur lg:border-r lg:border-b-0">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-cyan-400 text-lg font-black text-slate-950">R</div>
            <div>
              <p className="font-semibold tracking-tight text-slate-50">RAG Lab</p>
              <p className="text-xs text-slate-500">{isPublicDemo ? "Demo pública" : "Estudo visual"}</p>
            </div>
          </div>

          <nav className="mt-10 grid gap-2" aria-label="Etapas do laboratório">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm transition ${
                  activeTab === tab.id ? "bg-cyan-400/10 text-cyan-200" : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                }`}
              >
                <span className="font-mono text-xs text-slate-500">{tab.number}</span>
                <span className="font-medium">{tab.label}</span>
              </button>
            ))}
          </nav>

          <div className="mt-10 rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-xs leading-5 text-slate-400">
            <p className="font-medium text-slate-300">Pipeline</p>
            <p className="mt-2 font-mono text-[11px] text-slate-500">texto → chunks → vetores → busca → contexto</p>
          </div>
        </aside>

        <section className="p-6 sm:p-10">
          <header className="flex flex-col gap-5 border-b border-slate-800 pb-8 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-slate-400">{isPublicDemo ? "Demo pública · corpus somente leitura" : "Custom RAG · Node.js · pgvector"}</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Seu laboratório de recuperação</h1>
            </div>
            <div className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${apiOnline ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300"}`}>
              <span className={`size-1.5 rounded-full ${apiOnline ? "bg-emerald-400" : "bg-amber-400"}`} />
              {health.isLoading ? "Verificando API" : apiOnline ? "API conectada" : "API indisponível"}
            </div>
          </header>

          <div className="mt-10 grid gap-8 xl:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="min-w-0">
              {activeTab === "ingest" && (
                <form className="space-y-7" onSubmit={submitIngest}>
                  <SectionTitle eyebrow="Etapa 01" title="Indexe um documento">
                    O texto será dividido em chunks, convertido em embeddings e persistido no pgvector. Você poderá reenviar a mesma origem para reindexá-la.
                  </SectionTitle>
                  <div className="grid gap-5 rounded-2xl border border-slate-800 bg-slate-900/40 p-6 sm:grid-cols-2">
                    <InputLabel label="Origem (identificador único)">
                      <input value={source} onChange={(event) => setSource(event.target.value)} className="field" placeholder="notes/rag-basics" />
                    </InputLabel>
                    <InputLabel label="Título">
                      <input value={title} onChange={(event) => setTitle(event.target.value)} className="field" placeholder="Notas sobre RAG" />
                    </InputLabel>
                    <label className="grid gap-2 text-sm font-medium text-slate-300 sm:col-span-2">
                      Conteúdo do documento
                      <textarea value={text} onChange={(event) => setText(event.target.value)} className="field min-h-64 resize-y" placeholder="Cole suas anotações aqui. Comece explicando um conceito e depois faça perguntas na busca semântica." />
                    </label>
                  </div>
                  <button className="primary-button" disabled={isLoading} type="submit">{ingest.isPending ? "Indexando…" : "Criar chunks e indexar"}</button>
                  {ingest.data && <p className={ingest.data.highRiskChunks > 0 ? "mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200" : "success-message"}>
                    Documento indexado com {ingest.data.chunkCount} chunks.{" "}
                    {ingest.data.highRiskChunks > 0
                      ? `${ingest.data.highRiskChunks} chunk(s) de alto risco foram excluídos das respostas geradas.`
                      : "Nenhum chunk de alto risco foi detectado."}
                  </p>}
                </form>
              )}

              {activeTab === "search" && (
                <form className="space-y-7" onSubmit={submitSearch}>
                  <SectionTitle eyebrow="Etapa 02" title="Faça uma busca semântica">
                    A pergunta também vira um vetor. O banco ordena os chunks por distância cosseno e mostra os mais próximos.
                  </SectionTitle>
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
                    <InputLabel label="O que você quer encontrar?">
                      <textarea value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} className="field min-h-28 resize-y" placeholder="Como embeddings representam o significado de um texto?" />
                    </InputLabel>
                    <div className="mt-5 flex flex-wrap items-end justify-between gap-5">
                      <InputLabel label="Quantidade de chunks">
                        <select value={topK} onChange={(event) => setTopK(Number(event.target.value))} className="field w-36">
                          {[3, 5, 8, 10].map((value) => <option key={value} value={value}>top {value}</option>)}
                        </select>
                      </InputLabel>
                      <button className="primary-button" disabled={isLoading} type="submit">{search.isPending ? "Buscando…" : "Buscar chunks"}</button>
                    </div>
                  </div>
                  {search.data && (
                    <div className="space-y-3">
                      <p className="text-sm text-slate-400">{search.data.results.length} chunks retornados, ordenados por similaridade.</p>
                      {search.data.results.map((result, index) => <ResultCard key={result.chunkId} result={result} index={index} />)}
                    </div>
                  )}
                </form>
              )}

              {activeTab === "answer" && (
                <form className="space-y-7" onSubmit={submitQuestion}>
                  <SectionTitle eyebrow="Etapa 03" title="Pergunte usando o contexto recuperado">
                    A API recupera os chunks mais próximos, delimita material não confiável e exclui chunks sinalizados como alto risco antes de chamar o modelo.
                  </SectionTitle>
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
                    <InputLabel label="Pergunta">
                      <textarea value={question} onChange={(event) => setQuestion(event.target.value)} className="field min-h-28 resize-y" placeholder="Explique RAG com base nas minhas notas." />
                    </InputLabel>
                    <div className="mt-5 flex justify-end">
                      <button className="primary-button" disabled={isLoading} type="submit">{answer.isPending ? "Preparando resposta…" : "Perguntar ao RAG"}</button>
                    </div>
                  </div>
                  {answer.data && (
                    <div className="space-y-5 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-6">
                      <p className="whitespace-pre-wrap text-sm leading-7 text-slate-200">{answer.data.answer}</p>
                      <div className="border-t border-cyan-400/10 pt-4">
                        <p className="text-xs font-semibold tracking-[0.14em] text-cyan-300 uppercase">Fontes recuperadas</p>
                        <ul className="mt-3 grid gap-2">
                          {answer.data.sources.map((item) => <li key={`${item.source}-${item.chunk}`} className="flex justify-between gap-4 text-xs text-slate-400"><span className="truncate">{item.title ?? item.source} · chunk {item.chunk}</span><span className="font-mono text-cyan-300">{item.score.toFixed(3)}</span></li>)}
                        </ul>
                      </div>
                    </div>
                  )}
                </form>
              )}

              {currentError && !isLoading && <p className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{currentError}</p>}
            </div>

            <aside className="h-fit rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
              <p className="text-xs font-semibold tracking-[0.15em] text-slate-500 uppercase">O que observar</p>
              <ol className="mt-5 space-y-5 text-sm leading-6 text-slate-400">
                <li><span className="mr-2 font-mono text-cyan-300">01</span>O mesmo documento gera vários chunks.</li>
                <li><span className="mr-2 font-mono text-cyan-300">02</span>O score é similaridade, não certeza.</li>
                <li><span className="mr-2 font-mono text-cyan-300">03</span>O chat deve citar somente o contexto recuperado.</li>
              </ol>
              <div className="mt-7 border-t border-slate-800 pt-5 text-xs leading-5 text-slate-500">
                O banco já está ativo. A próxima etapa é ligar embeddings locais para completar esse ciclo sem AWS.
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}

