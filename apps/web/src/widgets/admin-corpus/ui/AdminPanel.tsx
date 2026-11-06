import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type IngestionEvent, type ManagedDocument, type UploadJob, type Workspace } from "../../../shared/api/rag-api";
import { supabase } from "../../../shared/lib/supabase";
import { EvaluationPanel } from "../../evaluation-dashboard/ui/EvaluationPanel";
import { Mascot } from "../../../shared/ui/Mascot";
import type { WorkspaceSection } from "../../../shared/lib/app-route";
import { WorkspaceOverview } from "../../workspace-control-center/ui/WorkspaceOverview";
import { WorkspaceOnboardingWizard } from "../../workspace-onboarding/ui/WorkspaceOnboardingWizard";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

const pipelineSteps = [
  ["queued", "File secured"],
  ["source_read", "Source read"],
  ["text_extraction", "Text extracted"],
  ["chunking", "Chunks created"],
  ["security_scan", "Risk assessed"],
  ["embedding", "Embeddings generated"],
  ["persistence", "pgvector indexed"]
] as const;

function eventForStage(events: IngestionEvent[], stage: string) {
  return [...events].reverse().find((event) => event.stage === stage);
}

function PipelineVisualization({ job, events }: { job: UploadJob; events: IngestionEvent[] }) {
  return <section className="panel overflow-hidden border-cyan-400/20 bg-cyan-400/[0.04]"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">Live ingestion pipeline</p><p className="mt-2 text-sm text-slate-300">{job.title ?? job.filename} · {job.progress}%</p><p className="mt-1 text-xs text-slate-500">Persisted timings and counters are kept without storing document content in the timeline.</p></div><span className={`status-pill ${job.status === "failed" ? "border-rose-400/30 bg-rose-400/10 text-rose-300" : "status-pill--success"}`}>{job.status}</span></div><div className="mt-5 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className={`h-full rounded-full transition-[width] duration-700 ${job.status === "failed" ? "bg-rose-400" : "bg-gradient-to-r from-cyan-400 to-emerald-400"}`} style={{ width: `${job.progress}%` }} /></div><ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{pipelineSteps.map(([stage, label], index) => { const event = eventForStage(events, stage); const complete = event?.status === "completed"; const active = event?.status === "started"; const failed = event?.status === "failed"; const details = event?.details ?? {}; const count = typeof details.chunkCount === "number" ? `${details.chunkCount} chunks` : typeof details.vectorCount === "number" ? `${details.vectorCount} vectors` : typeof details.highRiskChunks === "number" ? `${details.highRiskChunks} high-risk` : typeof details.characters === "number" ? `${details.characters.toLocaleString()} chars` : null; return <li key={stage} className={`rounded-xl border px-3 py-3 text-xs transition-colors ${complete ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : failed ? "border-rose-400/30 bg-rose-400/10 text-rose-200" : active ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-100" : "border-slate-800 bg-slate-950/40 text-slate-500"}`}><div className="flex items-center gap-3"><span className={`grid size-6 shrink-0 place-items-center rounded-full font-mono ${active ? "animate-pulse bg-cyan-400 text-slate-950" : complete ? "bg-emerald-400 text-slate-950" : "bg-slate-800"}`}>{complete ? "✓" : String(index + 1).padStart(2, "0")}</span><span>{label}</span></div>{event && <p className="mt-2 pl-9 font-mono text-[10px] opacity-80">{event.durationMs !== null ? `${event.durationMs} ms` : active ? "running" : "recorded"}{count ? ` · ${count}` : ""}</p>}</li>; })}</ol>{job.error && <p role="alert" className="mt-4 text-xs text-rose-300">{job.error}</p>}</section>;
}

export function AdminPanel({ section = "knowledge", selectedWorkspaceId, onWorkspaceChange, onSectionChange, onNavigateToAsk }: { section?: WorkspaceSection; selectedWorkspaceId?: string; onWorkspaceChange?: (workspaceId: string) => void; onSectionChange?: (section: WorkspaceSection) => void; onNavigateToAsk?: () => void }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState("");
  const [title, setTitle] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<ManagedDocument | null>(null);
  const [workspaceId, setWorkspaceId] = useState(() => selectedWorkspaceId ?? window.localStorage.getItem("rag-lab-workspace-id") ?? "");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceSlug, setWorkspaceSlug] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("viewer");
  const [documentFilter, setDocumentFilter] = useState("");
  const [jobFilter, setJobFilter] = useState<"all" | UploadJob["status"]>("all");

  useEffect(() => {
    void supabase?.auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? null));
  }, []);

  useEffect(() => {
    if (selectedWorkspaceId && selectedWorkspaceId !== workspaceId) {
      setWorkspaceId(selectedWorkspaceId);
      window.localStorage.setItem("rag-lab-workspace-id", selectedWorkspaceId);
      setSelectedDocument(null);
    }
  }, [selectedWorkspaceId, workspaceId]);

  const jobs = useQuery({
    queryKey: ["ingestion-jobs", token, workspaceId], queryFn: () => api.listUploads(token as string, workspaceId),
    enabled: Boolean(token && ["overview", "knowledge", "processing"].includes(section)), refetchInterval: 3_000
  });
  const activeJob = jobs.data?.jobs.find((job) => job.status === "processing" || job.status === "queued") ?? jobs.data?.jobs[0];
  const ingestionEvents = useQuery({
    queryKey: ["ingestion-events", token, workspaceId, activeJob?.id],
    queryFn: () => api.listUploadEvents(activeJob?.id as string, token as string, workspaceId),
    enabled: Boolean(token && activeJob?.id && ["overview", "knowledge", "processing"].includes(section)), refetchInterval: activeJob?.status === "processing" || activeJob?.status === "queued" ? 1_500 : false
  });
  const documents = useQuery({
    queryKey: ["documents", token, workspaceId], queryFn: () => api.listDocuments(token as string, workspaceId),
    enabled: Boolean(token && ["overview", "knowledge"].includes(section)), refetchInterval: 5_000
  });
  const workspaces = useQuery({ queryKey: ["workspaces", token], queryFn: () => api.workspaces(token as string), enabled: Boolean(token) });
  const availableWorkspaces = workspaces.data?.workspaces ?? [];
  useEffect(() => { const first = availableWorkspaces[0]; if (first && !availableWorkspaces.some((item) => item.tenantId === workspaceId)) { setWorkspaceId(first.tenantId); window.localStorage.setItem("rag-lab-workspace-id", first.tenantId); } }, [availableWorkspaces, workspaceId]);
  const workspace = availableWorkspaces.find((item) => item.tenantId === workspaceId) as Workspace | undefined;
  const readOnly = workspace?.role === "viewer";
  const members = useQuery({ queryKey: ["workspace-members", token, workspaceId], queryFn: () => api.listWorkspaceMembers(workspaceId, token as string), enabled: Boolean(token && workspaceId && workspace?.role === "owner" && section === "team") });
  const usage = useQuery({ queryKey: ["usage-summary", token, workspaceId], queryFn: () => api.getUsageSummary(token as string, workspaceId), enabled: Boolean(token && workspaceId && workspace?.role === "owner" && ["overview", "settings"].includes(section)), refetchInterval: 30_000 });
  const evaluations = useQuery({ queryKey: ["evaluation-runs", token, workspaceId], queryFn: () => api.listEvaluationRuns(token as string, workspaceId), enabled: Boolean(token && workspaceId && workspace?.role === "owner" && ["overview", "evaluations"].includes(section)) });
  const chunks = useQuery({
    queryKey: ["document-chunks", token, selectedDocument?.id],
    queryFn: () => api.listDocumentChunks(selectedDocument?.id as string, token as string, workspaceId),
    enabled: Boolean(token && selectedDocument && section === "knowledge")
  });
  const refreshDocuments = () => queryClient.invalidateQueries({ queryKey: ["documents", token] });

  const login = useMutation({
    mutationFn: async () => {
      if (!supabase) throw new Error("Supabase Auth is not configured for this demo.");
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.session) throw error ?? new Error("The session could not be started.");
      return data.session.access_token;
    },
    onSuccess: (accessToken) => { setToken(accessToken); setMessage("Admin session started."); }
  });
  const createWorkspace = useMutation({
    mutationFn: () => {
      if (!token) throw new Error("Your session has expired.");
      return api.createWorkspace({ name: workspaceName, slug: workspaceSlug, accessToken: token });
    },
    onSuccess: ({ workspace: created }) => {
      setWorkspaceId(created.tenantId); window.localStorage.setItem("rag-lab-workspace-id", created.tenantId);
      setWorkspaceName(""); setWorkspaceSlug(""); setMessage("Workspace created. You are its owner.");
      void queryClient.invalidateQueries({ queryKey: ["workspaces", token] });
    }
  });
  const inviteMember = useMutation({
    mutationFn: () => {
      if (!token || !workspaceId) throw new Error("Select a workspace.");
      return api.inviteWorkspaceMember({ workspaceId, email: inviteEmail, role: inviteRole, accessToken: token });
    },
    onSuccess: () => { setInviteEmail(""); setMessage("Invitation sent and workspace access prepared."); void queryClient.invalidateQueries({ queryKey: ["workspace-members", token, workspaceId] }); }
  });
  const changeMemberRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: "editor" | "viewer" }) => {
      if (!token || !workspaceId) throw new Error("Select a workspace.");
      return api.changeWorkspaceMemberRole({ workspaceId, userId, role, accessToken: token });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["workspace-members", token, workspaceId] })
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => {
      if (!token || !workspaceId) throw new Error("Select a workspace.");
      return api.removeWorkspaceMember({ workspaceId, userId, accessToken: token });
    },
    onSuccess: () => { setMessage("Member removed from the workspace."); void queryClient.invalidateQueries({ queryKey: ["workspace-members", token, workspaceId] }); }
  });
  const upload = useMutation({
    mutationFn: () => {
      if (!file || !token) throw new Error("Select a file and sign in as an administrator.");
      return api.uploadDocument({ file, source: source || `upload/${file.name}`, title: title || undefined, accessToken: token, workspaceId });
    },
    onSuccess: () => {
      setMessage("Upload queued. Processing continues in the background.");
      setFile(null); void jobs.refetch(); void refreshDocuments();
    }
  });
  const retry = useMutation({
    mutationFn: (jobId: string) => {
      if (!token) throw new Error("Your admin session has expired.");
      return api.retryUpload(jobId, token, workspaceId);
    },
    onSuccess: () => { setMessage("Processing queued again."); void jobs.refetch(); }
  });
  const reindex = useMutation({
    mutationFn: (documentId: string) => {
      if (!token) throw new Error("Your admin session has expired.");
      return api.reindexDocument(documentId, token, workspaceId);
    },
    onSuccess: () => { setMessage("Reindexing queued using the private original file."); void jobs.refetch(); void refreshDocuments(); }
  });
  const remove = useMutation({
    mutationFn: (documentId: string) => {
      if (!token) throw new Error("Your admin session has expired.");
      return api.deleteDocument(documentId, token, workspaceId);
    },
    onSuccess: () => {
      setSelectedDocument(null); setMessage("Document, chunks, and original file removed.");
      void refreshDocuments(); void jobs.refetch();
    }
  });
  const runEvaluation = useMutation({
    mutationFn: () => {
      if (!token || !workspaceId) throw new Error("Select a workspace.");
      return api.runEvaluation(token, workspaceId);
    },
    onSuccess: () => { setMessage("Evaluation completed and saved."); void queryClient.invalidateQueries({ queryKey: ["evaluation-runs", token, workspaceId] }); }
  });

  async function logout() { await supabase?.auth.signOut(); setToken(null); setSelectedDocument(null); setMessage("Signed out."); }
  function submitLogin(event: FormEvent) { event.preventDefault(); login.mutate(); }
  function submitUpload(event: FormEvent) { event.preventDefault(); upload.mutate(); }
  function submitWorkspace(event: FormEvent) { event.preventDefault(); createWorkspace.mutate(); }
  function submitInvitation(event: FormEvent) { event.preventDefault(); inviteMember.mutate(); }
  function confirmDelete(document: ManagedDocument) {
    if (window.confirm(`Remove “${document.title ?? document.source}”? This deletes its chunks and original file.`)) remove.mutate(document.id);
  }

  if (!supabase) {
    return <section className="space-y-4"><h2 className="text-2xl font-semibold">Workspace setup unavailable</h2><p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">Workspace sign-in is not configured yet. Add the Supabase settings to connect your private knowledge library.</p></section>;
  }
  if (!token) {
    return <form className="panel mx-auto max-w-xl space-y-5" onSubmit={submitLogin}><div className="flex items-center gap-4"><Mascot size="sm" /><div><p className="eyebrow">Welcome back</p><h2 className="mt-1 text-2xl font-semibold">Open your knowledge library</h2></div></div><p className="text-sm text-slate-400">Sign in securely to manage documents, members, and workspace settings.</p><input className="field" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Work email" required /><input className="field" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" required /><button className="primary-button" disabled={login.isPending}>{login.isPending ? "Opening workspace…" : "Continue"}</button>{login.error && <p className="text-sm text-rose-300">{login.error.message}</p>}</form>;
  }

  if (!workspaces.isLoading && workspaces.data?.workspaces.length === 0) {
    return <section className="panel mx-auto max-w-xl space-y-5"><div className="flex items-center gap-4"><Mascot size="sm" /><div><p className="eyebrow">Your first space</p><h2 className="mt-1 text-2xl font-semibold">Create a workspace</h2></div></div><p className="text-sm text-slate-400">Keep each team’s knowledge separate, invite the right people, and give every workspace its own context.</p><form className="grid gap-4" onSubmit={submitWorkspace}><input className="field" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Workspace name (for example, TI)" minLength={2} maxLength={100} required /><input className="field" value={workspaceSlug} onChange={(event) => setWorkspaceSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} placeholder="Workspace URL (for example, ti)" pattern="[a-z0-9-]{2,60}" minLength={2} maxLength={60} required /><button className="primary-button w-fit" disabled={createWorkspace.isPending}>{createWorkspace.isPending ? "Creating…" : "Create workspace"}</button>{createWorkspace.error && <p role="alert" className="text-sm text-rose-300">{createWorkspace.error.message}</p>}</form><button className="text-sm text-slate-400 hover:text-white" onClick={() => void logout()}>Sign out</button></section>;
  }

  const actionError = upload.error ?? retry.error ?? reindex.error ?? remove.error ?? inviteMember.error ?? changeMemberRole.error ?? removeMember.error ?? runEvaluation.error;
  const sectionCopy: Record<WorkspaceSection, { title: string; description: string }> = {
    overview: { title: "A clear view of this workspace", description: "See what is ready, what is processing, and what the team should do next." },
    knowledge: { title: "Keep trusted knowledge current", description: "Upload sources, inspect chunks, and reindex private originals when the content changes." },
    processing: { title: "Follow every ingestion step", description: "See extraction, chunking, safety checks, embeddings, and vector persistence as they happen." },
    team: { title: "Give people the right access", description: "Invite teammates and keep each workspace scoped to the people who need it." },
    evaluations: { title: "Make answer quality visible", description: "Run the golden set and review retrieval and safety signals before sharing results." },
    settings: { title: "Shape workspace policies", description: "Review the selected workspace, role, usage guardrails, and sign-in state." }
  };
  const copy = sectionCopy[section];
  const filteredDocuments = useMemo(() => (documents.data?.documents ?? []).filter((document) => `${document.title ?? ""} ${document.source}`.toLowerCase().includes(documentFilter.trim().toLowerCase())), [documents.data?.documents, documentFilter]);
  const filteredJobs = useMemo(() => (jobs.data?.jobs ?? []).filter((job) => jobFilter === "all" || job.status === jobFilter), [jobs.data?.jobs, jobFilter]);
  const usagePanel = workspace?.role === "owner" && usage.data ? <section className="panel"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">AI usage · last 30 days</p><p className="mt-2 text-sm text-slate-400">Estimated values use configured model prices. Cache hits have no model cost.</p></div><span className={`font-mono text-sm ${usage.data.alert.triggered ? "text-rose-300" : "text-cyan-300"}`}>${usage.data.summary.estimatedCostUsd.toFixed(4)}</span></div>{usage.data.alert.triggered && <p className="mt-4 rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">Estimated usage reached the configured budget alert of ${usage.data.alert.thresholdUsd.toFixed(2)}.</p>}<div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="workspace-metric"><p className="text-xs text-slate-500">Requests</p><p className="mt-1 font-mono text-sm text-slate-100">{usage.data.summary.requests}</p></div><div className="workspace-metric"><p className="text-xs text-slate-500">Cache hits</p><p className="mt-1 font-mono text-sm text-slate-100">{usage.data.summary.cacheHits}</p></div><div className="workspace-metric"><p className="text-xs text-slate-500">Average latency</p><p className="mt-1 font-mono text-sm text-slate-100">{Math.round(usage.data.summary.averageLatencyMs)} ms</p></div><div className="workspace-metric"><p className="text-xs text-slate-500">Provider failures</p><p className="mt-1 font-mono text-sm text-slate-100">{usage.data.summary.providerFailures}</p></div></div></section> : null;
  return <section className="space-y-8">
    <div className="flex flex-col justify-between gap-4 border-b border-slate-800/80 pb-6 sm:flex-row sm:items-end"><div><p className="eyebrow">{section === "settings" ? "Workspace settings" : "Workspace"}</p><h2 className="mt-2 text-2xl font-semibold text-white">{copy.title}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{copy.description}</p></div><button className="text-sm text-slate-400 hover:text-white" onClick={() => void logout()}>Sign out</button></div>
    <label className="grid max-w-sm gap-2 text-sm text-slate-300">Workspace<select className="field" value={workspaceId} onChange={(event) => { const nextWorkspaceId = event.target.value; setWorkspaceId(nextWorkspaceId); window.localStorage.setItem("rag-lab-workspace-id", nextWorkspaceId); setSelectedDocument(null); onWorkspaceChange?.(nextWorkspaceId); }}><option value="" disabled>Select a workspace</option>{workspaces.data?.workspaces.map((item) => <option key={item.tenantId} value={item.tenantId}>{item.tenantName} · {item.role}</option>)}</select></label>
    {readOnly && <p className="rounded-xl border border-violet-400/30 bg-violet-400/10 p-3 text-sm text-violet-100">You are a viewer in this workspace. You can inspect knowledge and processing, but changes require editor or owner access.</p>}

    {section === "overview" && <div className="space-y-6"><WorkspaceOnboardingWizard key={workspaceId} workspaceId={workspaceId} currentSection={section} onNavigate={(target) => target === "answer" ? onNavigateToAsk?.() : onSectionChange?.(target)} /><WorkspaceOverview workspace={workspace} documents={documents.data?.documents ?? []} jobs={jobs.data?.jobs ?? []} usage={usage.data?.summary} evaluations={evaluations.data?.runs ?? []} onNavigate={(nextSection) => onSectionChange?.(nextSection)} /></div>}

    {section === "team" && (workspace?.role === "owner" ? <section className="panel space-y-5"><div><p className="eyebrow">Team & access</p><h3 className="mt-2 text-lg font-semibold text-white">Workspace members</h3><p className="mt-2 text-sm text-slate-400">Only owners can invite, change roles, or remove editors and viewers.</p></div><form className="grid gap-3 sm:grid-cols-[1fr_10rem_auto]" onSubmit={submitInvitation}><input className="field" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="email@example.com" required /><select className="field" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "editor" | "viewer")}><option value="viewer">Viewer · read-only</option><option value="editor">Editor · knowledge</option></select><button className="primary-button" disabled={inviteMember.isPending}>{inviteMember.isPending ? "Sending…" : "Invite member"}</button></form><div className="divide-y divide-slate-800 rounded-xl border border-slate-800">{members.isLoading && <div className="p-4 text-sm text-slate-500">Loading members…</div>}{members.data?.members.map((member) => <div className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm" key={member.userId}><div><p className="text-slate-200">{member.email ?? "Email unavailable"}</p><p className="mt-1 font-mono text-xs text-slate-500">{member.role}</p></div>{member.role === "owner" ? <span className="text-xs text-cyan-300">Protected owner</span> : <div className="flex items-center gap-2"><select className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs" value={member.role} onChange={(event) => changeMemberRole.mutate({ userId: member.userId, role: event.target.value as "editor" | "viewer" })}><option value="viewer">Viewer</option><option value="editor">Editor</option></select><button className="text-xs text-rose-300 hover:text-rose-100" type="button" onClick={() => { if (window.confirm(`Remove ${member.email ?? "this member"}?`)) removeMember.mutate(member.userId); }}>Remove</button></div>}</div>)}</div></section> : <p className="empty-state">Only workspace owners can manage members and invitations.</p>)}

    {section === "settings" && <div className="space-y-5"><section className="panel"><p className="eyebrow">Workspace profile</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><div className="rounded-xl border border-slate-800 bg-slate-950/45 p-4"><p className="text-xs text-slate-500">Name</p><p className="mt-2 text-sm text-slate-100">{workspace?.tenantName ?? "Not selected"}</p></div><div className="rounded-xl border border-slate-800 bg-slate-950/45 p-4"><p className="text-xs text-slate-500">Slug</p><p className="mt-2 font-mono text-sm text-slate-100">{workspace?.tenantSlug ?? "—"}</p></div><div className="rounded-xl border border-slate-800 bg-slate-950/45 p-4"><p className="text-xs text-slate-500">Your role</p><p className="mt-2 text-sm capitalize text-slate-100">{workspace?.role ?? "—"}</p></div><div className="rounded-xl border border-slate-800 bg-slate-950/45 p-4"><p className="text-xs text-slate-500">Data boundary</p><p className="mt-2 text-sm text-emerald-300">Isolated to this workspace</p></div></div></section>{usagePanel}</div>}

    {section === "evaluations" && (workspace?.role === "owner" ? <EvaluationPanel runs={evaluations.data?.runs ?? []} isLoading={evaluations.isLoading} isRunning={runEvaluation.isPending} onRun={() => runEvaluation.mutate()} /> : <p className="empty-state">Evaluations are available to workspace owners.</p>)}

    {section === "knowledge" && <div className="space-y-6">{!readOnly && <form className="panel grid gap-4" onSubmit={submitUpload}><div><p className="eyebrow">Add knowledge</p><h3 className="mt-2 text-lg font-semibold text-white">Upload a source your team trusts</h3><p className="mt-2 text-sm text-slate-400">Lumora stores the original privately, extracts text, checks risk, creates chunks, and indexes embeddings.</p></div><input className="field" value={source} onChange={(event) => setSource(event.target.value)} placeholder="Unique source (for example, legal/playbook)" /><input className="field" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Optional title" /><input className="field" type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required /><button className="primary-button w-fit" disabled={upload.isPending}>{upload.isPending ? "Queueing…" : "Send for processing"}</button></form>}<div className="space-y-3"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow">Knowledge library</p><h3 className="mt-2 text-lg font-semibold text-white">Indexed documents</h3><p className="mt-2 text-sm text-slate-400">Open chunks to inspect the units that actually reach retrieval.</p></div><div className="flex flex-wrap gap-2"><input className="field w-full sm:w-56" aria-label="Filter documents" value={documentFilter} onChange={(event) => setDocumentFilter(event.target.value)} placeholder="Filter documents…" /><span className="status-pill">{filteredDocuments.length} shown</span></div></div>{documents.isLoading && <div className="grid gap-3"><div className="skeleton h-24" /><div className="skeleton h-24" /></div>}{!documents.isLoading && filteredDocuments.length === 0 && <p className="empty-state">{documentFilter ? "No documents match this filter." : "No documents have been indexed yet."}</p>}<div className="grid gap-3">{filteredDocuments.map((document) => <article className={`rounded-xl border p-4 transition duration-200 hover:-translate-y-0.5 ${selectedDocument?.id === document.id ? "border-cyan-400/50 bg-cyan-400/5" : "border-slate-800 bg-slate-900/30"}`} key={document.id}><div className="flex flex-col justify-between gap-4 sm:flex-row"><button className="min-w-0 text-left" type="button" onClick={() => setSelectedDocument(document)}><p className="truncate text-sm font-medium text-slate-100">{document.title ?? document.source}</p><p className="mt-1 truncate font-mono text-xs text-slate-500">{document.source}</p><p className="mt-2 text-xs text-slate-400">{document.chunkCount} chunks · updated {formatDate(document.updatedAt)}</p></button><div className="flex shrink-0 items-start gap-3 text-xs font-medium"><button type="button" className="text-cyan-300 hover:text-cyan-100" onClick={() => setSelectedDocument(document)}>View chunks</button>{!readOnly && <><button type="button" className="text-violet-300 hover:text-violet-100" onClick={() => reindex.mutate(document.id)} disabled={reindex.isPending}>Reindex</button><button type="button" className="text-rose-300 hover:text-rose-100" onClick={() => confirmDelete(document)} disabled={remove.isPending}>Delete</button></>}</div></div></article>)}</div></div>{selectedDocument && <section className="panel space-y-3"><div className="flex items-center justify-between gap-3"><div><p className="eyebrow">Chunk inspector</p><h3 className="mt-2 text-lg font-semibold text-white">{selectedDocument.title ?? selectedDocument.source}</h3><p className="mt-2 text-sm text-slate-400">Order, content, and security classification after ingestion.</p></div><button type="button" className="text-xs text-slate-400 hover:text-white" onClick={() => setSelectedDocument(null)}>Close</button></div>{chunks.isLoading && <p className="text-sm text-slate-400">Loading chunks…</p>}<div className="grid gap-3">{chunks.data?.chunks.map((chunk) => <article key={chunk.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-4"><div className="flex items-center justify-between gap-4"><p className="font-mono text-xs text-cyan-300">chunk {String(chunk.ordinal).padStart(2, "0")}</p><p className={`text-xs ${chunk.security.promptInjectionRisk === "high" ? "text-rose-300" : chunk.security.promptInjectionRisk === "medium" ? "text-amber-300" : "text-emerald-300"}`}>Risk: {chunk.security.promptInjectionRisk}</p></div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{chunk.content}</p></article>)}</div></section>}</div>}

    {section === "processing" && <div className="space-y-6">{activeJob && <PipelineVisualization job={activeJob} events={ingestionEvents.data?.events ?? []} />}<section className="panel space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">Processing center</p><h3 className="mt-2 text-lg font-semibold text-white">Recent ingestion jobs</h3><p className="mt-2 text-sm text-slate-400">Follow each document from private upload to searchable knowledge.</p></div><select className="field w-auto py-2 text-xs" aria-label="Filter processing jobs" value={jobFilter} onChange={(event) => setJobFilter(event.target.value as typeof jobFilter)}><option value="all">All statuses</option><option value="processing">Processing</option><option value="completed">Completed</option><option value="failed">Failed</option><option value="queued">Queued</option></select></div>{filteredJobs.length === 0 && !jobs.isLoading && <p className="empty-state">No processing jobs match this filter.</p>}{filteredJobs.map((job) => <article className="animate-fade-up rounded-xl border border-slate-800 bg-slate-900/30 p-4 text-sm" key={job.id}><div className="flex justify-between gap-4"><span className="truncate text-slate-100">{job.title ?? job.filename}</span><span className="font-mono text-xs text-cyan-300">{job.status} · {job.progress}%</span></div><p className="mt-1 text-xs text-slate-500">{job.source} {job.chunkCount !== null ? `· ${job.chunkCount} chunks` : ""}</p>{job.error && <p role="alert" className="mt-2 text-xs text-rose-300">{job.error}</p>}{!readOnly && job.status === "failed" && <button className="mt-3 text-xs font-medium text-cyan-300 hover:text-cyan-100" onClick={() => retry.mutate(job.id)} disabled={retry.isPending}>{retry.isPending ? "Queueing again…" : "Try again"}</button>}</article>)}</section></div>}

    {message && <p className="success-message" role="status">{message}</p>}
    {actionError && <p className="error-message" role="alert">{actionError.message}</p>}
  </section>;
}
