import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ManagedDocument, type UploadJob, type Workspace } from "../../../shared/api/rag-api";
import { supabase } from "../../../shared/lib/supabase";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function PipelineVisualization({ job }: { job: UploadJob }) {
  const current = job.status === "queued" ? 0 : job.status === "processing" ? 2 : job.status === "completed" ? 5 : -1;
  const steps = ["Arquivo recebido", "Texto extraído", "Chunks criados", "Risco analisado", "Embeddings", "pgvector pronto"];
  return <section className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold tracking-[.15em] text-cyan-300 uppercase">Pipeline de ingestão</p><p className="mt-2 text-sm text-slate-300">{job.title ?? job.filename} · {job.progress}%</p></div><span className={`rounded-full px-2.5 py-1 font-mono text-xs ${job.status === "failed" ? "bg-rose-500/10 text-rose-300" : "bg-cyan-400/10 text-cyan-200"}`}>{job.status}</span></div><ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{steps.map((step, index) => { const complete = current > index; const active = current === index; const failed = job.status === "failed" && index === Math.max(0, current); return <li key={step} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-xs ${complete ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : failed ? "border-rose-400/30 bg-rose-400/10 text-rose-200" : active ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-100" : "border-slate-800 bg-slate-950/40 text-slate-500"}`}><span className={`grid size-6 shrink-0 place-items-center rounded-full font-mono ${active ? "animate-pulse bg-cyan-400 text-slate-950" : complete ? "bg-emerald-400 text-slate-950" : "bg-slate-800"}`}>{complete ? "✓" : String(index + 1).padStart(2, "0")}</span>{step}</li>; })}</ol>{job.error && <p className="mt-4 text-xs text-rose-300">{job.error}</p>}</section>;
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
  const [workspaceId, setWorkspaceId] = useState(() => window.localStorage.getItem("rag-lab-workspace-id") ?? "");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceSlug, setWorkspaceSlug] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("viewer");

  useEffect(() => {
    void supabase?.auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? null));
  }, []);

  const jobs = useQuery({
    queryKey: ["ingestion-jobs", token, workspaceId], queryFn: () => api.listUploads(token as string, workspaceId),
    enabled: Boolean(token), refetchInterval: 3_000
  });
  const documents = useQuery({
    queryKey: ["documents", token, workspaceId], queryFn: () => api.listDocuments(token as string, workspaceId),
    enabled: Boolean(token), refetchInterval: 5_000
  });
  const workspaces = useQuery({ queryKey: ["workspaces", token], queryFn: () => api.workspaces(token as string), enabled: Boolean(token) });
  const availableWorkspaces = workspaces.data?.workspaces ?? [];
  useEffect(() => { const first = availableWorkspaces[0]; if (first && !availableWorkspaces.some((item) => item.tenantId === workspaceId)) { setWorkspaceId(first.tenantId); window.localStorage.setItem("rag-lab-workspace-id", first.tenantId); } }, [availableWorkspaces, workspaceId]);
  const workspace = availableWorkspaces.find((item) => item.tenantId === workspaceId) as Workspace | undefined;
  const readOnly = workspace?.role === "viewer";
  const members = useQuery({ queryKey: ["workspace-members", token, workspaceId], queryFn: () => api.listWorkspaceMembers(workspaceId, token as string), enabled: Boolean(token && workspaceId && workspace?.role === "owner") });
  const chunks = useQuery({
    queryKey: ["document-chunks", token, selectedDocument?.id],
    queryFn: () => api.listDocumentChunks(selectedDocument?.id as string, token as string, workspaceId),
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
  const createWorkspace = useMutation({
    mutationFn: () => {
      if (!token) throw new Error("Sua sessão expirou.");
      return api.createWorkspace({ name: workspaceName, slug: workspaceSlug, accessToken: token });
    },
    onSuccess: ({ workspace: created }) => {
      setWorkspaceId(created.tenantId); window.localStorage.setItem("rag-lab-workspace-id", created.tenantId);
      setWorkspaceName(""); setWorkspaceSlug(""); setMessage("Workspace criado. Você é o owner.");
      void queryClient.invalidateQueries({ queryKey: ["workspaces", token] });
    }
  });
  const inviteMember = useMutation({
    mutationFn: () => {
      if (!token || !workspaceId) throw new Error("Selecione um workspace.");
      return api.inviteWorkspaceMember({ workspaceId, email: inviteEmail, role: inviteRole, accessToken: token });
    },
    onSuccess: () => { setInviteEmail(""); setMessage("Convite enviado e acesso ao workspace preparado."); void queryClient.invalidateQueries({ queryKey: ["workspace-members", token, workspaceId] }); }
  });
  const changeMemberRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: "editor" | "viewer" }) => {
      if (!token || !workspaceId) throw new Error("Selecione um workspace.");
      return api.changeWorkspaceMemberRole({ workspaceId, userId, role, accessToken: token });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["workspace-members", token, workspaceId] })
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => {
      if (!token || !workspaceId) throw new Error("Selecione um workspace.");
      return api.removeWorkspaceMember({ workspaceId, userId, accessToken: token });
    },
    onSuccess: () => { setMessage("Membro removido do workspace."); void queryClient.invalidateQueries({ queryKey: ["workspace-members", token, workspaceId] }); }
  });
  const upload = useMutation({
    mutationFn: () => {
      if (!file || !token) throw new Error("Selecione um arquivo e entre como administrador.");
      return api.uploadDocument({ file, source: source || `upload/${file.name}`, title: title || undefined, accessToken: token, workspaceId });
    },
    onSuccess: () => {
      setMessage("Upload enfileirado. O processamento continua em segundo plano.");
      setFile(null); void jobs.refetch(); void refreshDocuments();
    }
  });
  const retry = useMutation({
    mutationFn: (jobId: string) => {
      if (!token) throw new Error("Sua sessão administrativa expirou.");
      return api.retryUpload(jobId, token, workspaceId);
    },
    onSuccess: () => { setMessage("Processamento reenfileirado."); void jobs.refetch(); }
  });
  const reindex = useMutation({
    mutationFn: (documentId: string) => {
      if (!token) throw new Error("Sua sessão administrativa expirou.");
      return api.reindexDocument(documentId, token, workspaceId);
    },
    onSuccess: () => { setMessage("Reindexação enfileirada usando o arquivo original privado."); void jobs.refetch(); void refreshDocuments(); }
  });
  const remove = useMutation({
    mutationFn: (documentId: string) => {
      if (!token) throw new Error("Sua sessão administrativa expirou.");
      return api.deleteDocument(documentId, token, workspaceId);
    },
    onSuccess: () => {
      setSelectedDocument(null); setMessage("Documento, chunks e arquivo original removidos.");
      void refreshDocuments(); void jobs.refetch();
    }
  });

  async function logout() { await supabase?.auth.signOut(); setToken(null); setSelectedDocument(null); setMessage("Sessão encerrada."); }
  function submitLogin(event: FormEvent) { event.preventDefault(); login.mutate(); }
  function submitUpload(event: FormEvent) { event.preventDefault(); upload.mutate(); }
  function submitWorkspace(event: FormEvent) { event.preventDefault(); createWorkspace.mutate(); }
  function submitInvitation(event: FormEvent) { event.preventDefault(); inviteMember.mutate(); }
  function confirmDelete(document: ManagedDocument) {
    if (window.confirm(`Remover “${document.title ?? document.source}”? Esta ação apaga chunks e o arquivo original.`)) remove.mutate(document.id);
  }

  if (!supabase) {
    return <section className="space-y-4"><h2 className="text-2xl font-semibold">Administração indisponível</h2><p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no frontend, além da lista ADMIN_EMAILS na API.</p></section>;
  }
  if (!token) {
    return <form className="space-y-5" onSubmit={submitLogin}><h2 className="text-2xl font-semibold">Entrar como administrador</h2><p className="text-sm text-slate-400">A senha é validada pelo Supabase Auth. A chave interna da API nunca chega ao navegador.</p><input className="field" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="E-mail" required /><input className="field" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Senha" required /><button className="primary-button" disabled={login.isPending}>{login.isPending ? "Entrando…" : "Entrar"}</button>{login.error && <p className="text-sm text-rose-300">{login.error.message}</p>}</form>;
  }

  if (!workspaces.isLoading && workspaces.data?.workspaces.length === 0) {
    return <section className="mx-auto max-w-xl space-y-5 rounded-2xl border border-slate-800 bg-slate-900/40 p-6"><div><p className="text-xs font-semibold tracking-[.18em] uppercase text-cyan-300">Onboarding</p><h2 className="mt-2 text-2xl font-semibold">Crie seu primeiro workspace</h2><p className="mt-2 text-sm text-slate-400">O workspace separa documentos, membros e permissões. Você será o owner.</p></div><form className="grid gap-4" onSubmit={submitWorkspace}><input className="field" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Nome do workspace" minLength={3} maxLength={100} required /><input className="field" value={workspaceSlug} onChange={(event) => setWorkspaceSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} placeholder="identificador-exemplo" pattern="[a-z0-9-]{3,60}" minLength={3} maxLength={60} required /><button className="primary-button w-fit" disabled={createWorkspace.isPending}>{createWorkspace.isPending ? "Criando…" : "Criar workspace"}</button>{createWorkspace.error && <p className="text-sm text-rose-300">{createWorkspace.error.message}</p>}</form><button className="text-sm text-slate-400 hover:text-white" onClick={() => void logout()}>Sair</button></section>;
  }

  const actionError = upload.error ?? retry.error ?? reindex.error ?? remove.error ?? inviteMember.error ?? changeMemberRole.error ?? removeMember.error;
  return (
    <section className="space-y-8">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold tracking-[.18em] uppercase text-cyan-300">Área protegida</p><h2 className="mt-2 text-2xl font-semibold">Gerencie o corpus</h2><p className="mt-2 text-sm text-slate-400">Uploads, reindexação e remoção acontecem pelo servidor; arquivos originais não ficam públicos.</p></div><button className="text-sm text-slate-400 hover:text-white" onClick={() => void logout()}>Sair</button></div>
      <label className="grid gap-2 text-sm text-slate-300">Workspace<select className="field" value={workspaceId} onChange={(event) => { setWorkspaceId(event.target.value); window.localStorage.setItem("rag-lab-workspace-id", event.target.value); setSelectedDocument(null); }}>{workspaces.data?.workspaces.map((item) => <option key={item.tenantId} value={item.tenantId}>{item.tenantName} · {item.role}</option>)}</select></label>
      {readOnly && <p className="rounded-lg border border-violet-400/30 bg-violet-400/10 p-3 text-sm text-violet-100">Você é viewer neste workspace: pode consultar documentos e chunks, mas não alterar o corpus.</p>}

      {workspace?.role === "owner" && <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-6"><div><h3 className="font-medium">Membros do workspace</h3><p className="mt-1 text-xs text-slate-500">Somente owners podem convidar, trocar o papel ou remover editores e viewers.</p></div><form className="grid gap-3 sm:grid-cols-[1fr_10rem_auto]" onSubmit={submitInvitation}><input className="field" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="email@exemplo.com" required /><select className="field" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "editor" | "viewer")}><option value="viewer">Viewer · leitura</option><option value="editor">Editor · corpus</option></select><button className="primary-button" disabled={inviteMember.isPending}>{inviteMember.isPending ? "Enviando…" : "Convidar"}</button></form><div className="divide-y divide-slate-800 rounded-xl border border-slate-800">{members.data?.members.map((member) => <div className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm" key={member.userId}><div><p className="text-slate-200">{member.email ?? "E-mail indisponível"}</p><p className="font-mono text-xs text-slate-500">{member.role}</p></div>{member.role === "owner" ? <span className="text-xs text-cyan-300">Owner protegido</span> : <div className="flex items-center gap-2"><select className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs" value={member.role} onChange={(event) => changeMemberRole.mutate({ userId: member.userId, role: event.target.value as "editor" | "viewer" })}><option value="viewer">Viewer</option><option value="editor">Editor</option></select><button className="text-xs text-rose-300 hover:text-rose-100" type="button" onClick={() => { if (window.confirm(`Remover ${member.email ?? "este membro"}?`)) removeMember.mutate(member.userId); }}>Remover</button></div>}</div>)}</div></section>}

      {!readOnly && <form className="grid gap-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-6" onSubmit={submitUpload}><p className="text-sm font-medium text-slate-200">Adicionar documento</p><input className="field" value={source} onChange={(event) => setSource(event.target.value)} placeholder="Origem única (ex.: docs/arquitetura)" /><input className="field" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Título opcional" /><input className="field" type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required /><button className="primary-button w-fit" disabled={upload.isPending}>{upload.isPending ? "Enfileirando…" : "Enviar para processamento"}</button></form>}

      {message && <p className="success-message">{message}</p>}
      {actionError && <p className="text-sm text-rose-300">{actionError.message}</p>}
      {jobs.data?.jobs[0] && <PipelineVisualization job={jobs.data.jobs[0]} />}

      <div className="space-y-3"><div><h3 className="font-medium">Documentos indexados</h3><p className="mt-1 text-xs text-slate-500">Abra os chunks para inspecionar a unidade que realmente chega ao retrieval.</p></div>{documents.isLoading && <p className="text-sm text-slate-400">Carregando documentos…</p>}{documents.data?.documents.length === 0 && <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">Ainda não há documentos indexados.</p>}<div className="grid gap-3">{documents.data?.documents.map((document) => <article className={`rounded-xl border p-4 transition ${selectedDocument?.id === document.id ? "border-cyan-400/50 bg-cyan-400/5" : "border-slate-800 bg-slate-900/30"}`} key={document.id}><div className="flex flex-col justify-between gap-4 sm:flex-row"><button className="min-w-0 text-left" type="button" onClick={() => setSelectedDocument(document)}><p className="truncate text-sm font-medium text-slate-100">{document.title ?? document.source}</p><p className="mt-1 truncate font-mono text-xs text-slate-500">{document.source}</p><p className="mt-2 text-xs text-slate-400">{document.chunkCount} chunks · atualizado em {formatDate(document.updatedAt)}</p></button><div className="flex shrink-0 items-start gap-3 text-xs font-medium"><button type="button" className="text-cyan-300 hover:text-cyan-100" onClick={() => setSelectedDocument(document)}>Ver chunks</button>{!readOnly && <><button type="button" className="text-violet-300 hover:text-violet-100" onClick={() => reindex.mutate(document.id)} disabled={reindex.isPending}>Reindexar</button><button type="button" className="text-rose-300 hover:text-rose-100" onClick={() => confirmDelete(document)} disabled={remove.isPending}>Excluir</button></>}</div></div></article>)}</div></div>

      {selectedDocument && <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-5"><div className="flex items-center justify-between gap-3"><div><h3 className="font-medium">Chunks de {selectedDocument.title ?? selectedDocument.source}</h3><p className="mt-1 text-xs text-slate-500">Ordem, conteúdo e classificação de segurança após a ingestão.</p></div><button type="button" className="text-xs text-slate-400 hover:text-white" onClick={() => setSelectedDocument(null)}>Fechar</button></div>{chunks.isLoading && <p className="text-sm text-slate-400">Carregando chunks…</p>}<div className="grid gap-3">{chunks.data?.chunks.map((chunk) => <article key={chunk.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-4"><div className="flex items-center justify-between gap-4"><p className="font-mono text-xs text-cyan-300">chunk {String(chunk.ordinal).padStart(2, "0")}</p><p className={`text-xs ${chunk.security.promptInjectionRisk === "high" ? "text-rose-300" : chunk.security.promptInjectionRisk === "medium" ? "text-amber-300" : "text-emerald-300"}`}>Risco: {chunk.security.promptInjectionRisk}</p></div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{chunk.content}</p></article>)}</div></section>}

      <div className="space-y-3"><h3 className="font-medium">Processamentos recentes</h3>{jobs.data?.jobs.map((job) => <article className="rounded-xl border border-slate-800 bg-slate-900/30 p-4 text-sm" key={job.id}><div className="flex justify-between gap-4"><span>{job.title ?? job.filename}</span><span className="font-mono text-cyan-300">{job.status} · {job.progress}%</span></div><p className="mt-1 text-xs text-slate-500">{job.source} {job.chunkCount !== null ? `· ${job.chunkCount} chunks` : ""}</p>{job.error && <p className="mt-2 text-xs text-rose-300">{job.error}</p>}{!readOnly && job.status === "failed" && <button className="mt-3 text-xs font-medium text-cyan-300 hover:text-cyan-100" onClick={() => retry.mutate(job.id)} disabled={retry.isPending}>{retry.isPending ? "Reenfileirando…" : "Tentar novamente"}</button>}</article>)}</div>
    </section>
  );
}
