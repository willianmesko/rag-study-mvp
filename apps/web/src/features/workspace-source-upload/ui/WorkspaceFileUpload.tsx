import { useId, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { workspaceRequestError } from "../../../shared/lib/request-error";

export function WorkspaceFileUpload({ token, workspaceId, onUploaded }: { token: string; workspaceId: string; onUploaded: () => void }) {
  const { t } = useLocale();
  const titleId = useId();
  const upload = useMutation({
    mutationFn: (input: { file: File; source: string; title?: string }) => api.uploadDocument({ ...input, accessToken: token, workspaceId }),
    onSuccess: onUploaded
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (upload.isPending) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const file = fields.get("file");
    if (!(file instanceof File) || !file.name) return;
    upload.mutate({ file, source: String(fields.get("source") ?? "").trim() || `upload/${file.name}`, title: String(fields.get("title") ?? "").trim() || undefined }, {
      onSuccess: () => {
        const fileInput = form.elements.namedItem("file");
        if (fileInput instanceof HTMLInputElement) fileInput.value = "";
      }
    });
  }

  return (
    <form className="panel grid min-w-0 content-start gap-4" onSubmit={submit} aria-labelledby={titleId} aria-busy={upload.isPending}>
      <div>
        <p className="eyebrow">{t("Add knowledge", "Adicionar documentos")}</p>
        <h3 id={titleId} className="mt-2 text-lg font-semibold text-white">{t("Upload a source your team trusts", "Envie uma fonte em que sua equipe confia")}</h3>
        <p className="mt-2 text-sm text-slate-400">{t("Lumora stores the original privately and prepares its text for search.", "O Lumora guarda o arquivo original em privado e prepara seu texto para a busca.")}</p>
      </div>
      <label className="grid gap-2 text-sm text-slate-300">
        {t("Source ID (optional)", "Identificador da fonte (opcional)")}
        <input className="field" name="source" maxLength={1000} readOnly={upload.isPending} placeholder={t("For example, legal/playbook", "Por exemplo, juridico/manual")} />
      </label>
      <label className="grid gap-2 text-sm text-slate-300">
        {t("Title (optional)", "Título (opcional)")}
        <input className="field" name="title" maxLength={500} readOnly={upload.isPending} />
      </label>
      <label className="grid gap-2 text-sm text-slate-300">
        {t("Document file", "Arquivo do documento")}
        <input className="field" name="file" type="file" accept=".pdf,.docx,.txt,.md,.markdown,.html,.htm" disabled={upload.isPending} required />
      </label>
      <button className="primary-button w-fit" type="submit" disabled={upload.isPending}>
        {upload.isPending ? t("Uploading…", "Enviando…") : t("Send for processing", "Enviar para processamento")}
      </button>
      {upload.isSuccess && <p className="success-message" role="status">{t("File received. You can follow its progress in Processing.", "Arquivo recebido. Você pode acompanhar o andamento em Processamento.")}</p>}
      {upload.isError && <p className="error-message" role="alert">
        {workspaceRequestError(upload.error, t, t("We could not upload this file. Check its size and format.", "Não foi possível enviar este arquivo. Verifique o tamanho e o formato."))}
      </p>}
    </form>
  );
}
