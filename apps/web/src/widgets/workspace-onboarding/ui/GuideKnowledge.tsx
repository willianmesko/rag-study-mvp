import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getStarterTemplate, type StarterGoal } from "../../../entities/starter-template/model/starter-templates";
import { InviteMemberDialog } from "../../../features/invite-workspace-member/ui/InviteMemberDialog";
import { guideDocumentsQuery, guideJobsQuery } from "../../../features/workspace-onboarding/model/knowledge-queries";
import { api, type UploadJob, type Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { getRequestErrorMessage } from "../../../shared/lib/request-error";
import { GuideConcepts } from "./GuideConcepts";

export function GuideKnowledge({ workspace, token, goal, onPendingChange }: {
  workspace: Workspace;
  token: string;
  goal: StarterGoal;
  onPendingChange: (pending: boolean) => void;
}) {
  const { locale, t } = useLocale();
  const template = getStarterTemplate(goal, locale);
  const queryClient = useQueryClient();
  const documentOptions = guideDocumentsQuery(token, workspace.tenantId);
  const jobOptions = guideJobsQuery(token, workspace.tenantId);
  const documents = useQuery(documentOptions);
  const jobs = useQuery(jobOptions);
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);
  const hintId = useId();
  const canUpload = workspace.role !== "viewer";
  const templateSource = `onboarding/templates/${template.filename}`;
  const activeJob = jobs.data?.jobs.find(({ id }) => id === selectedJobId)
    ?? jobs.data?.jobs.find(({ status }) => status === "queued" || status === "processing")
    ?? jobs.data?.jobs[0];
  const sampleExists = documents.data?.documents.some(({ source }) => source === templateSource)
    || jobs.data?.jobs.some(({ source, status }) => source === templateSource && (status === "queued" || status === "processing"));
  const upload = useMutation({
    mutationFn: ({ document, source }: { document: File; source: string }) => api.uploadDocument({
      file: document, source, accessToken: token, workspaceId: workspace.tenantId, signal: AbortSignal.timeout(60_000)
    }),
    onSuccess: ({ job }) => {
      setSelectedJobId(job.id);
      queryClient.setQueryData<{ jobs: UploadJob[] }>(jobOptions.queryKey, (current) => ({
        jobs: [job, ...(current?.jobs ?? []).filter(({ id }) => id !== job.id)]
      }));
      void queryClient.invalidateQueries({ queryKey: documentOptions.queryKey, exact: true });
      void queryClient.invalidateQueries({ queryKey: ["documents", token, workspace.tenantId], exact: true });
      void queryClient.invalidateQueries({ queryKey: ["ingestion-jobs", token, workspace.tenantId], exact: true });
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  });
  const sampleUnavailable = sampleExists || (upload.isSuccess && upload.variables?.source === templateSource && activeJob?.status !== "failed");

  useEffect(() => {
    onPendingChange(upload.isPending);
    return () => onPendingChange(false);
  }, [upload.isPending, onPendingChange]);

  useEffect(() => {
    if (activeJob?.status === "completed") void queryClient.invalidateQueries({ queryKey: documentOptions.queryKey, exact: true });
  }, [activeJob?.id, activeJob?.status, queryClient, token, workspace.tenantId]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canUpload && file && !upload.isPending) upload.mutate({ document: file, source: `onboarding/${encodeURIComponent(file.name).slice(0, 750)}` });
  }

  function downloadSample() {
    const url = URL.createObjectURL(new Blob([template.content], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = template.filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  return <div className="workspace-guide__detail" role="region" aria-label={t("Document setup", "Configuração de documentos")}
    aria-busy={documents.isPending || jobs.isPending}>
    <p>{workspace.role === "owner"
      ? t("You manage this workspace. Add a trusted document and invite teammates when you are ready.", "Você gerencia este espaço. Adicione um documento confiável e convide a equipe quando quiser.")
      : workspace.role === "editor"
        ? t("You can add documents and ask questions. The workspace owner manages invitations and access.", "Você pode adicionar documentos e fazer perguntas. O proprietário gerencia convites e acessos.")
        : t("You can read the team's documents and ask questions. An owner or editor prepares the files for you.", "Você pode ler os documentos da equipe e fazer perguntas. Um proprietário ou editor prepara os arquivos para você.")}</p>
    {canUpload && <>
      <div className="workspace-guide__example space-y-3">
        <strong>{t("No file handy? Try a safe sample", "Sem arquivo agora? Use um exemplo seguro")}</strong>
        <p>{template.title}. {t("Fictional content for practice. It does not describe your team's policies. Adding it counts as a document upload.", "Conteúdo fictício para praticar. Ele não descreve as políticas da sua equipe. Adicioná-lo conta como um envio de documento.")}</p>
        <div className="flex flex-wrap gap-2">
          <button className="secondary-button" type="button" disabled={upload.isPending || sampleUnavailable}
            onClick={() => upload.mutate({ document: new File([template.content], template.filename, { type: "text/markdown" }), source: templateSource })}>
            {upload.isPending && upload.variables?.source === templateSource
              ? t("Adding sample…", "Adicionando exemplo…")
              : sampleUnavailable ? t("Sample already added", "Exemplo já adicionado") : t("Use sample document", "Usar documento de exemplo")}
          </button>
          <button className="text-action min-h-11" type="button" onClick={downloadSample}>{t("Download sample", "Baixar exemplo")}</button>
        </div>
        <details>
          <summary>{t("Read the sample first", "Ler o exemplo antes")}</summary>
          <pre className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap text-xs leading-6 text-slate-300 [overflow-wrap:anywhere]">{template.content}</pre>
        </details>
      </div>
      <details className="w-full border-y border-slate-700 py-3">
        <summary className="min-h-11 py-3 text-sm font-medium text-slate-100">{t("Use your own document", "Usar seu próprio documento")}</summary>
      <form className="grid w-full gap-3 py-3" onSubmit={submit} aria-busy={upload.isPending}>
        <label className="grid min-w-0 gap-2 text-sm font-medium text-slate-200">
          {t("Choose a file (optional)", "Escolha um arquivo (opcional)")}
          <input ref={fileInput} className="field min-w-0" type="file" accept=".pdf,.docx,.txt,.md,.markdown" disabled={upload.isPending}
            aria-describedby={hintId} onChange={(event) => { setFile(event.target.files?.[0] ?? null); upload.reset(); }} />
        </label>
        <p id={hintId}>{t("PDF, Word (DOCX), plain text, or Markdown. A name such as Team handbook — reviewed 2026-11 helps people identify the current version.", "PDF, Word (DOCX), texto simples ou Markdown. Um nome como Manual da equipe — revisado em 2026-11 ajuda a identificar a versão atual.")}</p>
        <button className="secondary-button w-fit" type="submit" disabled={!file || upload.isPending}>
          {upload.isPending ? t("Uploading…", "Enviando…") : t("Upload document", "Enviar documento")}
        </button>
      </form>
      </details>
      <p>{t("Use approved team content. Keep passwords and unnecessary personal data out of files.", "Use materiais aprovados pela equipe. Remova senhas e dados pessoais desnecessários dos arquivos.")}</p>
      <details className="w-full">
        <summary className="min-h-11 py-3 text-sm font-medium text-slate-300">{t("How your documents are handled", "Como seus documentos são usados")}</summary>
        <p>{t("Upload only material you are allowed to share with this workspace. Selected passages may be sent to your configured AI provider; automated redaction is an extra safeguard, not permission to upload sensitive material.", "Envie apenas materiais autorizados para este espaço. Trechos selecionados podem ser enviados ao provedor de IA configurado; a remoção automática de dados é uma proteção extra, não uma autorização para enviar materiais sensíveis.")}</p>
      </details>
      {upload.isError && <p className="error-message" role="alert">{getRequestErrorMessage(upload.error, locale)}</p>}
      {upload.isPending && <p role="status">{t("Uploading your document. Preparation starts after the file is received…", "Enviando seu documento. O processamento começa após o recebimento do arquivo…")}</p>}
    </>}
    {activeJob && (activeJob.status !== "completed" || documents.data?.documents.some(({ source }) => source === activeJob.source)) && <section className="w-full space-y-2 border-b border-slate-700 py-3" aria-label={t("Document preparation", "Preparação do documento")}>
      <h3 className="break-words text-sm font-medium text-slate-100">{activeJob.filename}</h3>
      <p role="status">{activeJob.status === "completed"
        ? t(`Ready to use · ${activeJob.chunkCount ?? 0} passages`, `Pronto para usar · ${activeJob.chunkCount ?? 0} trechos`)
        : activeJob.status === "failed" ? t("Preparation failed. You can try another document or retry in Processing after setup.", "O processamento falhou. Use outro documento ou tente novamente em Processamento após a configuração.")
          : activeJob.status === "queued" ? t("File received. Waiting for preparation…", "Arquivo recebido. Aguardando processamento…")
            : t("Preparing your file: reading text, creating passages, and making them searchable…", "Preparando o arquivo: lendo o texto, criando trechos e deixando tudo pronto para busca…")}</p>
      <progress className="w-full" max={100} value={Math.max(0, Math.min(100, activeJob.progress))} aria-label={t("Document preparation progress", "Progresso de preparação do documento")} />
    </section>}
    {documents.isPending && <p role="status">{t("Checking available documents…", "Conferindo documentos disponíveis…")}</p>}
    {documents.data?.documents.length ? <div className="w-full">
      <h3 className="text-sm font-medium text-slate-100">{t("Ready for questions", "Prontos para perguntas")}</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-300">
        {documents.data.documents.slice(0, 5).map((document) => <li key={document.id} className="break-words">{document.title ?? document.source} · {t(`${document.chunkCount} passages`, `${document.chunkCount} trechos`)}</li>)}
      </ul>
    </div> : !documents.isPending && !documents.isError && <p>{t("No documents are ready yet. You can continue and come back when a file finishes processing.", "Nenhum documento está pronto ainda. Você pode continuar e voltar quando o processamento terminar.")}</p>}
    {(documents.isError || jobs.isError) && <div className="space-y-2">
      <p className="error-message" role="alert">{t("We couldn’t refresh document preparation. Your file may still be processing.", "Não conseguimos atualizar o processamento. Seu arquivo pode continuar sendo preparado.")}</p>
      <button className="secondary-button" type="button" onClick={() => { void documents.refetch(); void jobs.refetch(); }}>{t("Refresh documents", "Atualizar documentos")}</button>
    </div>}
    {workspace.role === "owner" && <details className="workspace-guide__example">
      <summary>{t("Bring your team (optional)", "Convide sua equipe (opcional)")}</summary>
      <p>{t("Invite a viewer to read and ask questions, or an editor to also manage documents. You can do this later in Team.", "Convide leitores para consultar e perguntar, ou editores para também gerenciar documentos. Você pode fazer isso depois em Pessoas.")}</p>
      <button type="button" className="secondary-button mt-3" aria-haspopup="dialog" onClick={() => setInviteOpen(true)}>{t("Invite a teammate", "Convidar pessoa")}</button>
      {invitedEmail && <p className="workspace-guide__ready break-words" role="status">{t(`Invitation sent to ${invitedEmail}.`, `Convite enviado para ${invitedEmail}.`)}</p>}
    </details>}
    {inviteOpen && workspace.role === "owner" && <InviteMemberDialog token={token} workspaceId={workspace.tenantId}
      onClose={() => setInviteOpen(false)} onInvited={(email) => { setInviteOpen(false); setInvitedEmail(email); }} />}
    <GuideConcepts />
  </div>;
}
