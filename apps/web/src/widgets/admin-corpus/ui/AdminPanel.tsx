import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, type IngestionEvent, type ManagedDocument, type UploadJob, type Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { EvaluationPanel } from "../../evaluation-dashboard/ui/EvaluationPanel";
import { SelectField } from "../../../shared/ui/SelectField";
import type { WorkspaceSection } from "../../../shared/lib/app-route";
import { WorkspaceOverview } from "../../workspace-control-center/ui/WorkspaceOverview";

type Translate = ReturnType<typeof useLocale>["t"];

function roleLabel(role: Workspace["role"], t: Translate) {
  return { owner: t("Owner", "Proprietário"), editor: t("Editor", "Editor"), viewer: t("Viewer", "Leitor") }[role];
}

function statusLabel(status: UploadJob["status"], t: Translate) {
  return {
    queued: t("Queued", "Na fila"),
    processing: t("Processing", "Em processamento"),
    completed: t("Completed", "Concluído"),
    failed: t("Failed", "Falhou")
  }[status];
}

function requestError(error: unknown, t: Translate, fallback: string) {
  if (!(error instanceof ApiError)) return fallback;
  switch (error.status) {
    case 401: return t("Sign in again to continue.", "Entre novamente para continuar.");
    case 403: return t("Your role does not allow this action.", "Seu perfil não permite esta ação.");
    case 404: return t("We could not find this item.", "Não encontramos este item.");
    case 413: return t("This file is too large to upload.", "Este arquivo é grande demais para envio.");
    case 429: return t("Usage limit reached. Try again later.", "Limite de uso atingido. Tente novamente mais tarde.");
    default: return fallback;
  }
}

function eventForStage(events: IngestionEvent[], stage: string) {
  return [...events].reverse().find((event) => event.stage === stage);
}

function PipelineVisualization({ job, events }: { job: UploadJob; events: IngestionEvent[] }) {
  const { locale, t } = useLocale();
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, { style: "percent" }).format(job.progress / 100);
  const pipelineSteps = [
    ["queued", t("File received", "Arquivo recebido")],
    ["source_read", t("Source read", "Fonte lida")],
    ["text_extraction", t("Text extracted", "Texto extraído")],
    ["chunking", t("Passages prepared", "Trechos preparados")],
    ["security_scan", t("Safety checked", "Segurança verificada")],
    ["embedding", t("Embeddings generated", "Representações vetoriais geradas")],
    ["persistence", t("Ready for search", "Disponível para busca")]
  ] as const;

  return (
    <section className="panel overflow-hidden border-cyan-400/20 bg-cyan-400/[0.04]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">{t("Live processing timeline", "Processamento em tempo real")}</p>
          <p className="mt-2 break-words text-sm text-slate-300">{job.title ?? job.filename} · {percent}</p>
          <p className="mt-1 text-xs text-slate-500">{t("This timeline records processing times and counts.", "Esta linha do tempo registra a duração e as contagens do processamento.")}</p>
        </div>
        <span className={"status-pill " + (job.status === "failed" ? "border-rose-400/30 bg-rose-400/10 text-rose-300" : "status-pill--success")}>{statusLabel(job.status, t)}</span>
      </div>
      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-slate-800" role="progressbar"
        aria-label={t("Document processing", "Processamento do documento")} aria-valuenow={job.progress}>
        <div className={"h-full rounded-full transition-[width] duration-700 " + (job.status === "failed" ? "bg-rose-400" : "bg-gradient-to-r from-cyan-400 to-emerald-400")} style={{ width: job.progress + "%" }} />
      </div>
      <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {pipelineSteps.map(([stage, label], index) => {
          const event = eventForStage(events, stage);
          const complete = event?.status === "completed";
          const active = event?.status === "started";
          const failed = event?.status === "failed";
          const details = event?.details;
          const count = typeof details?.chunkCount === "number" ? number.format(details.chunkCount) + " " + t("passages", "trechos")
            : typeof details?.vectorCount === "number" ? number.format(details.vectorCount) + " " + t("vectors", "vetores")
            : typeof details?.highRiskChunks === "number" ? number.format(details.highRiskChunks) + " " + t("high risk", "com risco alto")
            : typeof details?.characters === "number" ? number.format(details.characters) + " " + t("characters", "caracteres") : null;
          const tone = complete ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
            : failed ? "border-rose-400/30 bg-rose-400/10 text-rose-200"
            : active ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-100"
            : "border-slate-800 bg-slate-950/40 text-slate-500";
          const indicator = active ? "animate-pulse bg-cyan-400 text-slate-950"
            : complete ? "bg-emerald-400 text-slate-950" : "bg-slate-800";
          return (
            <li key={stage} className={"rounded-xl border px-3 py-3 text-xs transition-colors " + tone}>
              <div className="flex items-center gap-3">
                <span className={"grid size-6 shrink-0 place-items-center rounded-full font-mono " + indicator}>{complete ? "✓" : String(index + 1).padStart(2, "0")}</span>
                <span>{label}</span>
              </div>
              {event && <p className="mt-2 pl-9 font-mono text-[10px] opacity-80">
                {event.durationMs !== null ? number.format(event.durationMs) + " ms" : active ? t("in progress", "em andamento") : t("recorded", "registrado")}
                {count && " · " + count}
              </p>}
            </li>
          );
        })}
      </ol>
      {job.error && <p role="alert" className="mt-4 text-xs text-rose-300">{t("This file could not be processed. Check the file and try again.", "Não foi possível processar este arquivo. Verifique o arquivo e tente novamente.")}</p>}
    </section>
  );
}

export function AdminPanel({ section, workspace, token, onSectionChange }: {
  section: WorkspaceSection;
  workspace: Workspace;
  token: string;
  onSectionChange: (section: WorkspaceSection) => void;
}) {
  const { locale, t } = useLocale();
  const number = new Intl.NumberFormat(locale);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  const currency = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState<"invite" | "member" | "upload" | "retry" | "reindex" | "remove" | "evaluate" | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<ManagedDocument | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("viewer");
  const [documentFilter, setDocumentFilter] = useState("");
  const [jobFilter, setJobFilter] = useState<"all" | UploadJob["status"]>("all");
  const workspaceId = workspace.tenantId;
  const readOnly = workspace.role === "viewer";

  const jobs = useQuery({
    queryKey: ["ingestion-jobs", token, workspaceId], queryFn: () => api.listUploads(token as string, workspaceId),
    enabled: Boolean(token && workspace && ["overview", "knowledge", "processing"].includes(section)), refetchInterval: 3_000
  });
  const activeJob = jobs.data?.jobs.find((job) => job.status === "processing" || job.status === "queued") ?? jobs.data?.jobs[0];
  const ingestionEvents = useQuery({
    queryKey: ["ingestion-events", token, workspaceId, activeJob?.id],
    queryFn: () => api.listUploadEvents(activeJob?.id as string, token as string, workspaceId),
    enabled: Boolean(token && workspace && activeJob?.id && section === "processing"), refetchInterval: activeJob?.status === "processing" || activeJob?.status === "queued" ? 1_500 : false
  });
  const documents = useQuery({
    queryKey: ["documents", token, workspaceId], queryFn: () => api.listDocuments(token as string, workspaceId),
    enabled: Boolean(token && workspace && ["overview", "knowledge"].includes(section)), refetchInterval: 5_000
  });
  const members = useQuery({ queryKey: ["workspace-members", token, workspaceId], queryFn: () => api.listWorkspaceMembers(workspaceId, token as string), enabled: Boolean(token && workspaceId && workspace?.role === "owner" && section === "team") });
  const usage = useQuery({ queryKey: ["usage-summary", token, workspaceId], queryFn: () => api.getUsageSummary(token as string, workspaceId), enabled: Boolean(token && workspaceId && workspace?.role === "owner" && ["overview", "settings"].includes(section)), refetchInterval: 30_000 });
  const evaluations = useQuery({ queryKey: ["evaluation-runs", token, workspaceId], queryFn: () => api.listEvaluationRuns(token as string, workspaceId), enabled: Boolean(token && workspaceId && workspace?.role === "owner" && ["overview", "evaluations"].includes(section)) });
  const chunks = useQuery({
    queryKey: ["document-chunks", token, workspaceId, selectedDocument?.id],
    queryFn: () => api.listDocumentChunks(selectedDocument?.id as string, token as string, workspaceId),
    enabled: Boolean(token && workspace && selectedDocument && section === "knowledge")
  });
  const refreshDocuments = () => queryClient.invalidateQueries({ queryKey: ["documents", token] });

  const inviteMember = useMutation({
    mutationFn: () => {
      if (!token || !workspaceId) throw new Error("Select a workspace.");
      return api.inviteWorkspaceMember({ workspaceId, email: inviteEmail, role: inviteRole, accessToken: token });
    },
    onSuccess: () => { setInviteEmail(""); setMessage("invite"); void queryClient.invalidateQueries({ queryKey: ["workspace-members", token, workspaceId] }); }
  });
  const changeMemberRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: "editor" | "viewer" }) => {
      if (!token || !workspaceId) throw new Error("Select a workspace.");
      return api.changeWorkspaceMemberRole({ workspaceId, userId, role, accessToken: token });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspace-members", token, workspaceId] })
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => {
      if (!token || !workspaceId) throw new Error("Select a workspace.");
      return api.removeWorkspaceMember({ workspaceId, userId, accessToken: token });
    },
    onSuccess: () => {
      setMessage("member");
      return queryClient.invalidateQueries({ queryKey: ["workspace-members", token, workspaceId] });
    }
  });
  const upload = useMutation({
    mutationFn: () => {
      if (!file || !token) throw new Error("Select a file and sign in as an administrator.");
      return api.uploadDocument({ file, source: source || `upload/${file.name}`, title: title || undefined, accessToken: token, workspaceId });
    },
    onSuccess: () => {
      setMessage("upload");
      setFile(null); void jobs.refetch(); void refreshDocuments();
    }
  });
  const retry = useMutation({
    mutationFn: (jobId: string) => {
      if (!token) throw new Error("Your admin session has expired.");
      return api.retryUpload(jobId, token, workspaceId);
    },
    onSuccess: () => { setMessage("retry"); void jobs.refetch(); }
  });
  const reindex = useMutation({
    mutationFn: (documentId: string) => {
      if (!token) throw new Error("Your admin session has expired.");
      return api.reindexDocument(documentId, token, workspaceId);
    },
    onSuccess: () => { setMessage("reindex"); void jobs.refetch(); void refreshDocuments(); }
  });
  const remove = useMutation({
    mutationFn: (documentId: string) => {
      if (!token) throw new Error("Your admin session has expired.");
      return api.deleteDocument(documentId, token, workspaceId);
    },
    onSuccess: () => {
      setSelectedDocument(null); setMessage("remove");
      void refreshDocuments(); void jobs.refetch();
    }
  });
  const runEvaluation = useMutation({
    mutationFn: () => {
      if (!token || !workspaceId) throw new Error("Select a workspace.");
      return api.runEvaluation(token, workspaceId);
    },
    onSuccess: () => { setMessage("evaluate"); void queryClient.invalidateQueries({ queryKey: ["evaluation-runs", token, workspaceId] }); }
  });

  function submitUpload(event: FormEvent) { event.preventDefault(); upload.mutate(); }
  function submitInvitation(event: FormEvent) { event.preventDefault(); inviteMember.mutate(); }
  function confirmDelete(document: ManagedDocument) {
    if (window.confirm(t(`Remove “${document.title ?? document.source}” and its original file?`, `Remover “${document.title ?? document.source}” e o arquivo original?`))) remove.mutate(document.id);
  }

  const sectionCopy = {
    overview: [t("A clear view of this workspace", "Seu espaço em um só lugar"), t("See what is ready, what is processing, and what to do next.", "Veja o que está pronto, o que está em processamento e o que fazer a seguir.")],
    knowledge: [t("Keep trusted knowledge current", "Mantenha os documentos atualizados"), t("Upload sources, explore passages, and refresh the index when a file changes.", "Envie fontes, explore os trechos e atualize o índice quando um arquivo mudar.")],
    processing: [t("Follow every processing step", "Acompanhe cada etapa do processamento"), t("See how a file goes from upload to searchable knowledge.", "Veja como um arquivo fica disponível para busca depois do envio.")],
    team: [t("Give people the right access", "Gerencie o acesso da equipe"), t("Invite teammates and decide what each person can do.", "Convide colegas e defina o que cada pessoa pode fazer.")],
    evaluations: [t("Review answer quality", "Acompanhe a qualidade das respostas"), t("Run reference tests and review search quality and safety.", "Execute os testes de referência e confira a qualidade e a segurança da busca.")],
    settings: [t("Workspace settings", "Configurações do espaço"), t("Review the workspace profile and usage limits.", "Confira o perfil do espaço e os limites de uso.")]
  };
  const [heading, description] = sectionCopy[section];
  const messages = {
    invite: t("Invitation sent.", "Convite enviado."),
    member: t("Member removed.", "Membro removido."),
    upload: t("File received. You can follow its progress in Processing.", "Arquivo recebido. Você pode acompanhar o andamento em Processamento."),
    retry: t("File queued for another attempt.", "Arquivo na fila para uma nova tentativa."),
    reindex: t("Index update queued.", "Atualização do índice na fila."),
    remove: t("Document and original file removed.", "Documento e arquivo original removidos."),
    evaluate: t("Evaluation completed and saved.", "Avaliação concluída e salva.")
  };
  const errors = [
    [upload.error, t("We could not upload this file. Check its size and format.", "Não foi possível enviar este arquivo. Verifique o tamanho e o formato.")],
    [retry.error, t("We could not retry this file.", "Não foi possível reprocessar este arquivo.")],
    [reindex.error, t("We could not update the index. Check that the original file is available.", "Não foi possível atualizar o índice. Confira se o arquivo original está disponível.")],
    [remove.error, t("We could not delete this document.", "Não foi possível excluir este documento.")],
    [inviteMember.error, t("We could not send the invitation. Check the email address.", "Não foi possível enviar o convite. Verifique o endereço de e-mail.")],
    [changeMemberRole.error, t("We could not change this member’s role.", "Não foi possível alterar o perfil deste membro.")],
    [removeMember.error, t("We could not remove this member.", "Não foi possível remover este membro.")],
    [runEvaluation.error, t("We could not run the evaluation.", "Não foi possível executar a avaliação.")]
  ] as const;
  const actionError = errors.find(([error]) => error);
  const filteredDocuments = (documents.data?.documents ?? []).filter((document) => (
    [document.title, document.source].join(" ").toLocaleLowerCase(locale).includes(documentFilter.trim().toLocaleLowerCase(locale))
  ));
  const filteredJobs = (jobs.data?.jobs ?? []).filter((job) => jobFilter === "all" || job.status === jobFilter);
  const memberRoleOptions = [
    { value: "viewer", label: roleLabel("viewer", t), description: t("Can search and read documents.", "Pode buscar e ler documentos.") },
    { value: "editor", label: roleLabel("editor", t), description: t("Can add and manage documents.", "Pode adicionar e gerenciar documentos.") }
  ];
  const memberEditPending = changeMemberRole.isPending || removeMember.isPending;
  const jobStatuses = ["queued", "processing", "completed", "failed"] as const;
  const riskLabel = { high: t("High", "Alto"), medium: t("Medium", "Médio"), low: t("Low", "Baixo") };
  const usageMetrics = usage.data ? [
    [t("Requests", "Solicitações"), number.format(usage.data.summary.requests)],
    [t("Cache hits", "Respostas reutilizadas"), number.format(usage.data.summary.cacheHits)],
    [t("Average latency", "Latência média"), number.format(Math.round(usage.data.summary.averageLatencyMs)) + " ms"],
    [t("Provider failures", "Falhas do provedor"), number.format(usage.data.summary.providerFailures)]
  ] : [];

  return (
    <section className="space-y-8">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-800/80 pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">{t("Workspace", "Espaço de trabalho")}</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{heading}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{description}</p>
        </div>
      </div>
      {readOnly && <p className="rounded-xl border border-violet-400/30 bg-violet-400/10 p-3 text-sm text-violet-100">{t("Your access is read-only. You can browse documents and track processing.", "Seu acesso é somente leitura. Você pode explorar documentos e acompanhar o processamento.")}</p>}

      {section === "overview" && (
        <div className="space-y-6">
          <WorkspaceOverview workspace={workspace} documents={documents.data?.documents ?? []} jobs={jobs.data?.jobs ?? []}
            usage={usage.data?.summary} evaluations={evaluations.data?.runs ?? []} onNavigate={onSectionChange} />
        </div>
      )}

      {section === "team" && (workspace?.role === "owner" ? (
        <section className="panel space-y-5">
          <div>
            <p className="eyebrow">{t("Team and access", "Equipe e acesso")}</p>
            <h3 className="mt-2 text-lg font-semibold text-white">{t("Workspace members", "Membros do espaço")}</h3>
            <p className="mt-2 text-sm text-slate-400">{t("Owners can invite, change roles, and remove members.", "Proprietários podem convidar, alterar perfis e remover membros.")}</p>
          </div>
          <form className="grid gap-3 sm:grid-cols-2 sm:items-end lg:grid-cols-[minmax(0,1fr)_minmax(9rem,12rem)_auto]" onSubmit={submitInvitation}>
            <label className="grid min-w-0 gap-2 text-sm text-slate-300">
              {t("Email", "E-mail")}
              <input className="field" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@example.com" required />
            </label>
            <SelectField label={t("Role", "Perfil")} value={inviteRole} options={memberRoleOptions} disabled={inviteMember.isPending}
              onValueChange={(role) => {
                if (role === "editor" || role === "viewer") setInviteRole(role);
              }} />
            <button className="primary-button sm:col-span-2 sm:justify-self-start lg:col-span-1" disabled={inviteMember.isPending}>{inviteMember.isPending ? t("Sending…", "Enviando…") : t("Invite member", "Convidar")}</button>
          </form>
          <div className="divide-y divide-slate-800 rounded-xl border border-slate-800">
            {members.isLoading && <p className="p-4 text-sm text-slate-400" role="status">{t("Loading members…", "Carregando membros…")}</p>}
            {members.isError && <p className="p-4 text-sm text-rose-200" role="alert">{requestError(members.error, t, t("We could not load workspace members.", "Não foi possível carregar os membros do espaço."))}</p>}
            {members.data?.members.map((member) => {
              const name = member.email ?? t("Email unavailable", "E-mail indisponível");
              const pendingRole = changeMemberRole.isPending && changeMemberRole.variables?.userId === member.userId
                ? changeMemberRole.variables.role : undefined;
              return (
                <div className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm" key={member.userId}>
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="break-words text-slate-200">{name}</p>
                    <p className="mt-1 text-xs text-slate-500">{roleLabel(member.role, t)}</p>
                  </div>
                  {member.role === "owner" ? <span className="text-xs text-cyan-300">{t("Owner role protected", "Perfil de proprietário protegido")}</span> : (
                    <div className="flex w-full items-center gap-2 sm:w-auto">
                      <SelectField label={t("Role for " + name, "Perfil de " + name)} hideLabel
                        className="min-w-0 flex-1 sm:w-32" value={pendingRole ?? member.role} options={memberRoleOptions} disabled={memberEditPending}
                        onValueChange={(role) => {
                          if ((role === "editor" || role === "viewer") && role !== member.role) {
                            changeMemberRole.mutate({ userId: member.userId, role });
                          }
                        }} />
                      <button className="secondary-button min-h-11 shrink-0 text-rose-300 hover:text-rose-100" type="button" disabled={memberEditPending} onClick={() => {
                        if (window.confirm(t("Remove " + name + "?", "Remover " + name + "?"))) removeMember.mutate(member.userId);
                      }}>{t("Remove", "Remover")}</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : <p className="empty-state">{t("Only workspace owners can manage members and invitations.", "Somente proprietários podem gerenciar membros e convites.")}</p>)}

      {section === "settings" && (workspace?.role === "owner" ? (
        <div className="space-y-5">
          <section className="panel">
            <p className="eyebrow">{t("Workspace profile", "Perfil do espaço")}</p>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              {[
                [t("Name", "Nome"), workspace.tenantName],
                [t("Workspace URL", "Endereço do espaço"), workspace.tenantSlug],
                [t("Your role", "Seu perfil"), roleLabel(workspace.role, t)],
                [t("Data access", "Acesso aos dados"), t("Isolated to this workspace", "Restrito a este espaço")]
              ].map(([label, value]) => (
                <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-4" key={label}>
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd className="mt-2 text-sm text-slate-100">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
          {usage.isLoading && <p className="empty-state" role="status">{t("Loading usage…", "Carregando o uso…")}</p>}
          {usage.isError && <p className="error-message" role="alert">{requestError(usage.error, t, t("We could not load usage.", "Não foi possível carregar os dados de uso."))}</p>}
          {usage.data && (
            <section className="panel">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="eyebrow">{t("AI usage · last 30 days", "Uso de IA · últimos 30 dias")}</p>
                  <p className="mt-2 text-sm text-slate-400">{t("Costs are estimates based on the configured model prices.", "Os custos são estimados com base nos preços configurados para o modelo.")}</p>
                </div>
                <span className={"font-mono text-sm " + (usage.data.alert.triggered ? "text-rose-300" : "text-cyan-300")}>{currency.format(usage.data.summary.estimatedCostUsd)}</span>
              </div>
              {usage.data.alert.triggered && <p className="mt-4 rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">{t("Estimated usage reached the budget alert of", "O uso estimado atingiu o limite de alerta de")} {currency.format(usage.data.alert.thresholdUsd)}.</p>}
              <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {usageMetrics.map(([label, value]) => <div key={label} className="workspace-metric"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 font-mono text-sm text-slate-100">{value}</dd></div>)}
              </dl>
            </section>
          )}
        </div>
      ) : <p className="empty-state">{t("Workspace settings are available to owners.", "As configurações do espaço estão disponíveis para proprietários.")}</p>)}

      {section === "evaluations" && (workspace?.role === "owner" ? (
        evaluations.isError ? <p className="error-message" role="alert">{requestError(evaluations.error, t, t("We could not load evaluations.", "Não foi possível carregar as avaliações."))}</p>
        : <EvaluationPanel runs={evaluations.data?.runs ?? []} isLoading={evaluations.isLoading} isRunning={runEvaluation.isPending} onRun={() => runEvaluation.mutate()} />
      ) : <p className="empty-state">{t("Evaluations are available to workspace owners.", "As avaliações estão disponíveis para proprietários.")}</p>)}

      {section === "knowledge" && (
        <div className="space-y-6">
          {workspace && !readOnly && (
            <form className="panel grid gap-4" onSubmit={submitUpload}>
              <div>
                <p className="eyebrow">{t("Add knowledge", "Adicionar documentos")}</p>
                <h3 className="mt-2 text-lg font-semibold text-white">{t("Upload a source your team trusts", "Envie uma fonte em que sua equipe confia")}</h3>
                <p className="mt-2 text-sm text-slate-400">{t("Lumora stores the original privately and prepares its text for search.", "O Lumora guarda o arquivo original em privado e prepara seu texto para a busca.")}</p>
              </div>
              <label className="grid gap-2 text-sm text-slate-300">
                {t("Source ID (optional)", "Identificador da fonte (opcional)")}
                <input className="field" value={source} onChange={(event) => setSource(event.target.value)} placeholder={t("For example, legal/playbook", "Por exemplo, juridico/manual")} />
              </label>
              <label className="grid gap-2 text-sm text-slate-300">
                {t("Title (optional)", "Título (opcional)")}
                <input className="field" value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label className="grid gap-2 text-sm text-slate-300">
                {t("Document file", "Arquivo do documento")}
                <input className="field" type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required />
              </label>
              <button className="primary-button w-fit" disabled={upload.isPending}>{upload.isPending ? t("Uploading…", "Enviando…") : t("Send for processing", "Enviar para processamento")}</button>
            </form>
          )}
          <div className="space-y-3">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="eyebrow">{t("Knowledge library", "Biblioteca de documentos")}</p>
                <h3 className="mt-2 text-lg font-semibold text-white">{t("Searchable documents", "Documentos disponíveis para busca")}</h3>
                <p className="mt-2 text-sm text-slate-400">{t("Open a document to inspect the passages used in search.", "Abra um documento para conferir os trechos usados na busca.")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <input className="field w-full sm:w-56" aria-label={t("Filter documents", "Filtrar documentos")} value={documentFilter}
                  onChange={(event) => setDocumentFilter(event.target.value)} placeholder={t("Filter documents…", "Filtrar documentos…")} />
                <span className="status-pill">{number.format(filteredDocuments.length)} {t("shown", "exibidos")}</span>
              </div>
            </div>
            {documents.isLoading && <div className="grid gap-3" role="status" aria-label={t("Loading documents", "Carregando documentos")}><div className="skeleton h-24" /><div className="skeleton h-24" /></div>}
            {documents.isError && <p role="alert" className="error-message">{requestError(documents.error, t, t("We could not load documents.", "Não foi possível carregar os documentos."))}</p>}
            {documents.isSuccess && filteredDocuments.length === 0 && <p className="empty-state">{documentFilter ? t("No documents match this filter.", "Nenhum documento corresponde a esse filtro.") : t("No documents are ready for search yet.", "Ainda não há documentos disponíveis para busca.")}</p>}
            <div className="grid gap-3">
              {filteredDocuments.map((document) => (
                <article className={"rounded-xl border p-4 transition duration-200 hover:-translate-y-0.5 " + (selectedDocument?.id === document.id ? "border-cyan-400/50 bg-cyan-400/5" : "border-slate-800 bg-slate-900/30")} key={document.id}>
                  <div className="flex flex-col justify-between gap-4 sm:flex-row">
                    <button className="min-w-0 text-left" type="button" onClick={() => setSelectedDocument(document)}>
                      <p className="truncate text-sm font-medium text-slate-100">{document.title ?? document.source}</p>
                      <p className="mt-1 truncate font-mono text-xs text-slate-500">{document.source}</p>
                      <p className="mt-2 text-xs text-slate-400">{number.format(document.chunkCount)} {document.chunkCount === 1 ? t("passage", "trecho") : t("passages", "trechos")} · {t("updated", "atualizado em")} {date.format(new Date(document.updatedAt))}</p>
                    </button>
                    <div className="flex shrink-0 flex-wrap items-start gap-3 text-xs font-medium">
                      <button type="button" className="text-cyan-300 hover:text-cyan-100" onClick={() => setSelectedDocument(document)}>{t("View passages", "Ver trechos")}</button>
                      {workspace && !readOnly && <>
                        <button type="button" className="text-violet-300 hover:text-violet-100" onClick={() => reindex.mutate(document.id)} disabled={reindex.isPending}>{t("Refresh index", "Atualizar índice")}</button>
                        <button type="button" className="text-rose-300 hover:text-rose-100" onClick={() => confirmDelete(document)} disabled={remove.isPending}>{t("Delete", "Excluir")}</button>
                      </>}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
          {selectedDocument && (
            <section className="panel space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="eyebrow">{t("Document passages", "Trechos do documento")}</p>
                  <h3 className="mt-2 text-lg font-semibold text-white">{selectedDocument.title ?? selectedDocument.source}</h3>
                  <p className="mt-2 text-sm text-slate-400">{t("See the original text and the result of the safety check.", "Veja o texto original e o resultado da verificação de segurança.")}</p>
                </div>
                <button type="button" className="text-xs text-slate-400 hover:text-white" onClick={() => setSelectedDocument(null)}>{t("Close", "Fechar")}</button>
              </div>
              {chunks.isLoading && <p className="text-sm text-slate-400" role="status">{t("Loading passages…", "Carregando trechos…")}</p>}
              {chunks.isError && <p className="error-message" role="alert">{requestError(chunks.error, t, t("We could not load these passages.", "Não foi possível carregar estes trechos."))}</p>}
              <div className="grid gap-3">
                {chunks.data?.chunks.map((chunk) => (
                  <article key={chunk.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <p className="font-mono text-xs text-cyan-300">{t("Passage", "Trecho")} {String(chunk.ordinal).padStart(2, "0")}</p>
                      <p className={"text-xs " + (chunk.security.promptInjectionRisk === "high" ? "text-rose-300" : chunk.security.promptInjectionRisk === "medium" ? "text-amber-300" : "text-emerald-300")}>{t("Risk", "Risco")} · {riskLabel[chunk.security.promptInjectionRisk]}</p>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{chunk.content}</p>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {section === "processing" && (
        <div className="space-y-6">
          {activeJob && <PipelineVisualization job={activeJob} events={ingestionEvents.data?.events ?? []} />}
          {ingestionEvents.isError && <p className="error-message" role="alert">{requestError(ingestionEvents.error, t, t("We could not load the processing timeline.", "Não foi possível carregar a linha do tempo do processamento."))}</p>}
          <section className="panel space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="eyebrow">{t("Processing center", "Central de processamento")}</p>
                <h3 className="mt-2 text-lg font-semibold text-white">{t("Recently processed files", "Arquivos processados recentemente")}</h3>
                <p className="mt-2 text-sm text-slate-400">{t("Follow each file from upload to search.", "Acompanhe cada arquivo do envio à busca.")}</p>
              </div>
              <SelectField label={t("Processing status", "Status do processamento")} className="w-full sm:w-52"
                value={jobFilter}
                options={[
                  { value: "all", label: t("All statuses", "Todos os status") },
                  ...jobStatuses.map((status) => ({ value: status, label: statusLabel(status, t) }))
                ]}
                onValueChange={(value) => {
                  const status = jobStatuses.find((item) => item === value);
                  if (value === "all" || status) setJobFilter(status ?? "all");
                }} />
            </div>
            {jobs.isLoading && <p className="text-sm text-slate-400" role="status">{t("Loading files…", "Carregando arquivos…")}</p>}
            {jobs.isError && <p className="error-message" role="alert">{requestError(jobs.error, t, t("We could not load processing jobs.", "Não foi possível carregar os processamentos."))}</p>}
            {jobs.isSuccess && filteredJobs.length === 0 && <p className="empty-state">{t("No processing jobs match this filter.", "Nenhum processamento corresponde a esse filtro.")}</p>}
            {filteredJobs.map((job) => (
              <article className="animate-fade-up rounded-xl border border-slate-800 bg-slate-900/30 p-4 text-sm" key={job.id}>
                <div className="flex justify-between gap-4">
                  <span className="truncate text-slate-100">{job.title ?? job.filename}</span>
                  <span className="shrink-0 font-mono text-xs text-cyan-300">{statusLabel(job.status, t)} · {number.format(job.progress)}%</span>
                </div>
                <p className="mt-1 break-words text-xs text-slate-500">{job.source}{job.chunkCount !== null && " · " + number.format(job.chunkCount) + " " + (job.chunkCount === 1 ? t("passage", "trecho") : t("passages", "trechos"))}</p>
                {job.error && <p className="mt-2 text-xs text-rose-300">{t("Processing failed.", "Falha no processamento.")}</p>}
                {workspace && !readOnly && job.status === "failed" && <button type="button" className="mt-3 text-xs font-medium text-cyan-300 hover:text-cyan-100" onClick={() => retry.mutate(job.id)} disabled={retry.isPending}>{retry.isPending ? t("Queueing again…", "Colocando na fila…") : t("Try again", "Tentar novamente")}</button>}
              </article>
            ))}
          </section>
        </div>
      )}

      {message && <p className="success-message" role="status">{messages[message]}</p>}
      {actionError && <p className="error-message" role="alert">{requestError(actionError[0], t, actionError[1])}</p>}
    </section>
  );
}
