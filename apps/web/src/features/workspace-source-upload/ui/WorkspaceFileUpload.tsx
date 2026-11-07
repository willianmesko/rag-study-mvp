import { useEffect, useId, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { workspaceRequestError } from "../../../shared/lib/request-error";

export function WorkspaceFileUpload({ token, workspaceId, onUploaded, onPendingChange }: { token: string; workspaceId: string; onUploaded: () => void; onPendingChange?: (pending: boolean) => void }) {
  const { t } = useLocale();
  const titleId = useId();
  const upload = useMutation({
    mutationFn: (input: { file: File; source: string; title?: string }) => api.uploadDocument({ ...input, accessToken: token, workspaceId }),
    onSuccess: onUploaded
  });
  useEffect(() => { onPendingChange?.(upload.isPending); }, [onPendingChange, upload.isPending]);

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
    <form className="grid min-w-0 content-start gap-4" onSubmit={submit} aria-labelledby={titleId} aria-busy={upload.isPending}>
      <div>
        <h3 id={titleId} className="mt-2 text-lg font-semibold text-white">{t("Upload a document", "Envie um documento")}</h3>
        <p className="mt-2 text-sm text-slate-400">{t("Lumora keeps the original in this workspace and prepares the text for search and answers.", "O Lumora guarda o original neste espaço e prepara o texto para buscas e respostas.")}</p>
      </div>
      <label className="grid gap-2 text-sm text-slate-300">
        {t("Source label (optional)", "Nome de referência (opcional)")}
        <input className="field" name="source" maxLength={1000} readOnly={upload.isPending} placeholder={t("For example, team-handbook", "Por exemplo, manual-da-equipe")} />
      </label>
      <label className="grid gap-2 text-sm text-slate-300">
        {t("Title (optional)", "Título (opcional)")}
        <input className="field" name="title" maxLength={500} readOnly={upload.isPending} />
      </label>
      <label className="grid gap-2 text-sm text-slate-300">
        {t("Document file", "Arquivo do documento")}
        <input className="field" name="file" type="file" accept=".pdf,.docx,.txt,.md,.markdown,.html,.htm" disabled={upload.isPending} required />
      </label>
      <button className="primary-button w-fit" type="submit" disabled={upload.isPending} aria-busy={upload.isPending}>
        {upload.isPending ? t("Uploading…", "Enviando…") : t("Send for processing", "Enviar para processamento")}
      </button>
      {upload.isSuccess && <p className="success-message" role="status">{t("Document received. Open Processing to see when it’s ready to search.", "Documento recebido. Abra Processamento para saber quando ele estará pronto para busca.")}</p>}
      {upload.isError && <p className="error-message" role="alert">
        {workspaceRequestError(upload.error, t, t("We could not upload this file. Check its size and format.", "Não foi possível enviar este arquivo. Verifique o tamanho e o formato."))}
      </p>}
    </form>
  );
}
