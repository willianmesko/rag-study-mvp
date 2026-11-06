import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ManagedDocument } from "../lib/api";
import { supabase } from "../lib/supabase";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export function AdminPanel() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState("");
  const [title, setTitle] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<ManagedDocument | null>(null);

  useEffect(() => {
    void supabase?.auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? null));
  }, []);

  const jobs = useQuery({
    queryKey: ["ingestion-jobs", token], queryFn: () => api.listUploads(token as string),
    enabled: Boolean(token), refetchInterval: 3_000
  });
  const documents = useQuery({
    queryKey: ["documents", token], queryFn: () => api.listDocuments(token as string),
    enabled: Boolean(token), refetchInterval: 5_000
  });
  const chunks = useQuery({
    queryKey: ["document-chunks", token, selectedDocument?.id],
    queryFn: () => api.listDocumentChunks(selectedDocument?.id as string, token as string),
    enabled: Boolean(token && selectedDocument)
  });
  const refreshDocuments = () => queryClient.invalidateQueries({ queryKey: ["documents", token] });

  const login = useMutation({
    mutationFn: async () => {
      if (!supabase) throw new Error("Supabase Auth ainda não foi configurado para esta demo.");
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.session) throw error ?? new Error("Não foi possível iniciar a sessão.");
      return data.session.access_token;
    },
    onSuccess: (accessToken) => { setToken(accessToken); setMessage("Sessão administrativa iniciada."); }
  });
  const upload = useMutation({
    mutationFn: () => {
      if (!file || !token) throw new Error("Selecione um arquivo e entre como administrador.");
      return api.uploadDocument({ file, source: source || `upload/${file.name}`, title: title || undefined, accessToken: token });
    },
    onSuccess: () => {
      setMessage("Upload enfileirado. O processamento continua em segundo plano.");
      setFile(null); void jobs.refetch(); void refreshDocuments();
    }
  });
  const retry = useMutation({
    mutationFn: (jobId: string) => {
      if (!token) throw new Error("Sua sessão administrativa expirou.");
      return api.retryUpload(jobId, token);
    },
    onSuccess: () => { setMessage("Processamento reenfileirado."); void jobs.refetch(); }
  });
  const reindex = useMutation({
    mutationFn: (documentId: string) => {
      if (!token) throw new Error("Sua sessão administrativa expirou.");
      return api.reindexDocument(documentId, token);
    },
    onSuccess: () => { setMessage("Reindexação enfileirada usando o arquivo original privado."); void jobs.refetch(); void refreshDocuments(); }
  });
  const remove = useMutation({
    mutationFn: (documentId: string) => {
      if (!token) throw new Error("Sua sessão administrativa expirou.");
      return api.deleteDocument(documentId, token);
    },
    onSuccess: () => {
      setSelectedDocument(null); setMessage("Documento, chunks e arquivo original removidos.");
      void refreshDocuments(); void jobs.refetch();
    }
  });

  async function logout() { await supabase?.auth.signOut(); setToken(null); setSelectedDocument(null); setMessage("Sessão encerrada."); }
  function submitLogin(event: FormEvent) { event.preventDefault(); login.mutate(); }
  function submitUpload(event: FormEvent) { event.preventDefault(); upload.mutate(); }
  function confirmDelete(document: ManagedDocument) {
    if (window.confirm(`Remover “${document.title ?? document.source}”? Esta ação apaga chunks e o arquivo original.`)) remove.mutate(document.id);
  }

  if (!supabase) {
    return <section className="space-y-4"><h2 className="text-2xl font-semibold">Administração indisponível</h2><p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no frontend, além da lista ADMIN_EMAILS na API.</p></section>;
  }
  if (!token) {
    return <form className="space-y-5" onSubmit={submitLogin}><h2 className="text-2xl font-semibold">Entrar como administrador</h2><p className="text-sm text-slate-400">A senha é validada pelo Supabase Auth. A chave interna da API nunca chega ao navegador.</p><input className="field" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="E-mail" required /><input className="field" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Senha" required /><button className="primary-button" disabled={login.isPending}>{login.isPending ? "Entrando…" : "Entrar"}</button>{login.error && <p className="text-sm text-rose-300">{login.error.message}</p>}</form>;
  }

  const actionError = upload.error ?? retry.error ?? reindex.error ?? remove.error;
  return (
    <section className="space-y-8">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold tracking-[.18em] uppercase text-cyan-300">Área protegida</p><h2 className="mt-2 text-2xl font-semibold">Gerencie o corpus</h2><p className="mt-2 text-sm text-slate-400">Uploads, reindexação e remoção acontecem pelo servidor; arquivos originais não ficam públicos.</p></div><button className="text-sm text-slate-400 hover:text-white" onClick={() => void logout()}>Sair</button></div>

      <form className="grid gap-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-6" onSubmit={submitUpload}><p className="text-sm font-medium text-slate-200">Adicionar documento</p><input className="field" value={source} onChange={(event) => setSource(event.target.value)} placeholder="Origem única (ex.: docs/arquitetura)" /><input className="field" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Título opcional" /><input className="field" type="file" accept=".pdf,.docx,.txt,.md,.markdown,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required /><button className="primary-button w-fit" disabled={upload.isPending}>{upload.isPending ? "Enfileirando…" : "Enviar para processamento"}</button></form>

      {message && <p className="success-message">{message}</p>}
      {actionError && <p className="text-sm text-rose-300">{actionError.message}</p>}

      <div className="space-y-3"><div><h3 className="font-medium">Documentos indexados</h3><p className="mt-1 text-xs text-slate-500">Abra os chunks para inspecionar a unidade que realmente chega ao retrieval.</p></div>{documents.isLoading && <p className="text-sm text-slate-400">Carregando documentos…</p>}{documents.data?.documents.length === 0 && <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">Ainda não há documentos indexados.</p>}<div className="grid gap-3">{documents.data?.documents.map((document) => <article className={`rounded-xl border p-4 transition ${selectedDocument?.id === document.id ? "border-cyan-400/50 bg-cyan-400/5" : "border-slate-800 bg-slate-900/30"}`} key={document.id}><div className="flex flex-col justify-between gap-4 sm:flex-row"><button className="min-w-0 text-left" type="button" onClick={() => setSelectedDocument(document)}><p className="truncate text-sm font-medium text-slate-100">{document.title ?? document.source}</p><p className="mt-1 truncate font-mono text-xs text-slate-500">{document.source}</p><p className="mt-2 text-xs text-slate-400">{document.chunkCount} chunks · atualizado em {formatDate(document.updatedAt)}</p></button><div className="flex shrink-0 items-start gap-3 text-xs font-medium"><button type="button" className="text-cyan-300 hover:text-cyan-100" onClick={() => setSelectedDocument(document)}>Ver chunks</button><button type="button" className="text-violet-300 hover:text-violet-100" onClick={() => reindex.mutate(document.id)} disabled={reindex.isPending}>Reindexar</button><button type="button" className="text-rose-300 hover:text-rose-100" onClick={() => confirmDelete(document)} disabled={remove.isPending}>Excluir</button></div></div></article>)}</div></div>

      {selectedDocument && <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-5"><div className="flex items-center justify-between gap-3"><div><h3 className="font-medium">Chunks de {selectedDocument.title ?? selectedDocument.source}</h3><p className="mt-1 text-xs text-slate-500">Ordem, conteúdo e classificação de segurança após a ingestão.</p></div><button type="button" className="text-xs text-slate-400 hover:text-white" onClick={() => setSelectedDocument(null)}>Fechar</button></div>{chunks.isLoading && <p className="text-sm text-slate-400">Carregando chunks…</p>}<div className="grid gap-3">{chunks.data?.chunks.map((chunk) => <article key={chunk.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-4"><div className="flex items-center justify-between gap-4"><p className="font-mono text-xs text-cyan-300">chunk {String(chunk.ordinal).padStart(2, "0")}</p><p className={`text-xs ${chunk.security.promptInjectionRisk === "high" ? "text-rose-300" : chunk.security.promptInjectionRisk === "medium" ? "text-amber-300" : "text-emerald-300"}`}>Risco: {chunk.security.promptInjectionRisk}</p></div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{chunk.content}</p></article>)}</div></section>}

      <div className="space-y-3"><h3 className="font-medium">Processamentos recentes</h3>{jobs.data?.jobs.map((job) => <article className="rounded-xl border border-slate-800 bg-slate-900/30 p-4 text-sm" key={job.id}><div className="flex justify-between gap-4"><span>{job.title ?? job.filename}</span><span className="font-mono text-cyan-300">{job.status} · {job.progress}%</span></div><p className="mt-1 text-xs text-slate-500">{job.source} {job.chunkCount !== null ? `· ${job.chunkCount} chunks` : ""}</p>{job.error && <p className="mt-2 text-xs text-rose-300">{job.error}</p>}{job.status === "failed" && <button className="mt-3 text-xs font-medium text-cyan-300 hover:text-cyan-100" onClick={() => retry.mutate(job.id)} disabled={retry.isPending}>{retry.isPending ? "Reenfileirando…" : "Tentar novamente"}</button>}</article>)}</div>
    </section>
  );
}
