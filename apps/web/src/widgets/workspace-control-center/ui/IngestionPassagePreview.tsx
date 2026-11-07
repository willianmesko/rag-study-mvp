import { useQueryIdentity } from "../../../shared/lib/query-identity";
import { privateQueryKey } from "../../../shared/lib/query-keys";
import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, api } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";

type PreviewProps = { jobId: string; documentName: string; accessToken: string; workspaceId: string };

export function IngestionPassagePreview(props: PreviewProps) {
  const { t } = useLocale();
  const panelId = useId();
  const [open, setOpen] = useState(false);

  return <div className="mt-3">
    <button type="button" className="secondary-button min-h-9 px-3 text-xs" aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      aria-label={open ? undefined : t(`Preview passages from ${props.documentName}`, `Prévia dos trechos de ${props.documentName}`)}
      onClick={() => setOpen((value) => !value)}>
      {open ? t("Hide preview", "Ocultar prévia") : t("Preview passages", "Prévia dos trechos")}
    </button>
    {open && <PassageSample {...props} panelId={panelId} />}
  </div>;
}

function PassageSample({ jobId, accessToken, workspaceId, panelId }: PreviewProps & { panelId: string }) {
  const userId = useQueryIdentity();
  const { locale, t } = useLocale();
  const preview = useQuery({
    queryKey: privateQueryKey("ingestion-passage-preview", userId, workspaceId, jobId),
    queryFn: ({ signal }) => api.previewUploadPassages(jobId, accessToken, workspaceId, signal),
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false
  });

  return <div id={panelId} className="mt-3 space-y-3 rounded-xl border border-slate-700 bg-slate-950/60 p-4">
    {preview.isPending && <p role="status" className="text-sm text-slate-400">{t("Loading a sample…", "Carregando uma amostra…")}</p>}
    {preview.isError && <p role="alert" className="text-sm text-amber-200">
      {preview.error instanceof ApiError && preview.error.status === 404
        ? t("A preview is available for the current indexed revision only.", "A prévia está disponível para a versão indexada atual.")
        : t("We could not load this preview. Close it and try again.", "Não foi possível carregar a prévia. Feche e tente novamente.")}
    </p>}
    {preview.data && <>
      <p className="text-sm text-slate-300">{t(
        `Showing ${preview.data.passages.length.toLocaleString(locale)} of ${preview.data.totalChunks.toLocaleString(locale)} indexed passages.`,
        `Exibindo ${preview.data.passages.length.toLocaleString(locale)} de ${preview.data.totalChunks.toLocaleString(locale)} trechos indexados.`
      )}</p>
      <ol className="grid gap-2">
        {preview.data.passages.map((passage) => <li key={passage.chunkId} className="min-w-0 rounded-lg border border-slate-800 p-3">
          <p className="font-mono text-xs text-cyan-300">{t("Passage", "Trecho")} {(passage.chunk + 1).toLocaleString(locale)}</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-300">
            {passage.previewBlocked
              ? t("Preview hidden because this passage was flagged as high risk.", "Prévia oculta porque este trecho foi sinalizado como de alto risco.")
              : passage.excerpt}
          </p>
          {passage.excerptTruncated && <p className="mt-1 text-xs text-slate-400">{t("Preview limited to 600 characters.", "Prévia limitada a 600 caracteres.")}</p>}
        </li>)}
      </ol>
    </>}
  </div>;
}
