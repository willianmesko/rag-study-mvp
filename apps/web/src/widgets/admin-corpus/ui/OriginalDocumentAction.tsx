import { useEffect, useId, useRef, useState } from "react";
import { ApiError, api } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";

type OriginalDocumentProps = { documentId: string; documentName: string; accessToken: string; workspaceId: string };
type FileState = { status: "loading" } | { status: "ready"; filename: string; isPdf: boolean; url: string }
  | { status: "error"; code?: number };

export function OriginalDocumentAction(props: OriginalDocumentProps) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);

  return <>
    <button type="button" className="text-cyan-300 hover:text-cyan-100" aria-haspopup="dialog"
      aria-label={t(`Original file for ${props.documentName}`, `Arquivo original de ${props.documentName}`)}
      onClick={() => setOpen(true)}>{t("Original file", "Arquivo original")}</button>
    {open && <OriginalDocumentDialog {...props} onClose={() => setOpen(false)} />}
  </>;
}

function OriginalDocumentDialog({ documentId, documentName, accessToken, workspaceId, onClose }: OriginalDocumentProps & { onClose: () => void }) {
  const { t } = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [state, setState] = useState<FileState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setState({ status: "loading" });

    void api.getOriginalDocument({ documentId, workspaceId, accessToken, signal: controller.signal })
      .then(({ blob, filename, isPdf }) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ status: "ready", url: objectUrl, filename, isPdf });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ status: "error", code: error instanceof ApiError ? error.status : undefined });
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId, workspaceId, accessToken, attempt]);

  let errorMessage: string | undefined;
  if (state.status === "error") {
    switch (state.code) {
      case 401: errorMessage = t("Sign in again to open this file.", "Entre novamente para abrir este arquivo."); break;
      case 403: errorMessage = t("You don’t have access to this file.", "Você não tem acesso a este arquivo."); break;
      case 404: errorMessage = t("The original file is no longer available.", "O arquivo original não está mais disponível."); break;
      default: errorMessage = t("We couldn’t load the original file. Try again in a moment.", "Não foi possível carregar o arquivo original. Tente novamente em instantes.");
    }
  }

  return (
    <dialog ref={dialogRef} onClose={onClose} aria-labelledby={titleId}
      className="panel fixed inset-0 m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto bg-slate-950 text-slate-100 backdrop:bg-slate-950/75">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 id={titleId} className="text-lg font-semibold text-white">{t("Original file", "Arquivo original")}</h3>
          <p className="mt-1 break-words text-sm text-slate-400">{documentName}</p>
        </div>
        <button type="button" className="secondary-button" onClick={() => dialogRef.current?.close()}>{t("Close", "Fechar")}</button>
      </div>
      {state.status === "loading" && <p className="mt-5 text-sm text-slate-300" role="status">{t("Preparing your file…", "Preparando o arquivo…")}</p>}
      {state.status === "ready" && <div className="mt-5 space-y-3">
        <p className="break-words text-sm text-slate-300" role="status">{state.filename}</p>
        <div className="flex flex-wrap gap-2">
          {state.isPdf && <a className="secondary-button" href={state.url} target="_blank" rel="noopener noreferrer">{t("Open PDF in new tab", "Abrir PDF em nova aba")}</a>}
          <a className="primary-button" href={state.url} download={state.filename}>{t("Download original", "Baixar original")}</a>
        </div>
      </div>}
      {state.status === "error" && <div className="mt-5 space-y-3">
        <p className="error-message" role="alert">{errorMessage}</p>
        {state.code !== 401 && state.code !== 403 && state.code !== 404 && <button type="button" className="secondary-button" onClick={() => setAttempt((value) => value + 1)}>{t("Try again", "Tentar novamente")}</button>}
      </div>}
    </dialog>
  );
}
