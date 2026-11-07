import type { IngestionEvent, UploadJob } from "../../../shared/api/rag-api";
import { useLocale, type Translate } from "../../../shared/i18n/locale";
import { OcrEventDetails } from "./OcrEventDetails";

export function statusLabel(status: UploadJob["status"], t: Translate) {
  return {
    queued: t("Queued", "Na fila"),
    processing: t("Processing", "Em processamento"),
    completed: t("Completed", "Concluído"),
    failed: t("Failed", "Falhou")
  }[status];
}

function eventForStage(events: IngestionEvent[], stage: string) {
  return [...events].reverse().find((event) => event.stage === stage);
}

function ocrEventForCurrentAttempt(events: IngestionEvent[]) {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event.stage === "ocr") return event;
    if (event.stage === "queued" || (event.stage === "processing" && event.status === "started")) return undefined;
  }
}

export function PipelineVisualization({ job, events }: { job: UploadJob; events: IngestionEvent[] }) {
  const { locale, t } = useLocale();
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, { style: "percent" }).format(job.progress / 100);
  const ocrEvent = job.status === "queued" ? undefined : ocrEventForCurrentAttempt(events);
  const pipelineSteps = [
    ["queued", t("File received", "Arquivo recebido")],
    ["source_read", t("Source read", "Fonte lida")],
    ["text_extraction", ocrEvent ? t("Text extraction", "Extração de texto") : t("Text extracted", "Texto extraído")],
    ...(ocrEvent ? [["ocr", t("Text recognition (OCR)", "Reconhecimento de texto (OCR)")]] : []),
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
          <p className="mt-1 text-xs text-slate-400">{t("This timeline records processing times and counts.", "Esta linha do tempo registra a duração e as contagens do processamento.")}</p>
        </div>
        <span className={"status-pill " + (job.status === "failed" ? "border-rose-400/30 bg-rose-400/10 text-rose-300" : "status-pill--success")}>{statusLabel(job.status, t)}</span>
      </div>
      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-slate-800" role="progressbar"
        aria-label={t("Document processing", "Processamento do documento")} aria-valuenow={job.progress}>
        <div className={"h-full rounded-full transition-[width] duration-700 " + (job.status === "failed" ? "bg-rose-400" : "bg-gradient-to-r from-cyan-400 to-emerald-400")} style={{ width: job.progress + "%" }} />
      </div>
      <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {pipelineSteps.map(([stage, label], index) => {
          const event = stage === "ocr" ? ocrEvent : eventForStage(events, stage);
          const complete = event?.status === "completed";
          const active = event?.status === "started";
          const failed = event?.status === "failed";
          const details = event?.details;
          const ocrSkipped = stage === "ocr" && event?.status === "info" && details?.code === "ocr_disabled";
          const count = typeof details?.chunkCount === "number" ? number.format(details.chunkCount) + " " + t("passages", "trechos")
            : typeof details?.vectorCount === "number" ? number.format(details.vectorCount) + " " + t("vectors", "vetores")
            : typeof details?.highRiskChunks === "number" ? number.format(details.highRiskChunks) + " " + t("high risk", "com risco alto")
            : typeof details?.characters === "number" ? number.format(details.characters) + " " + t("characters", "caracteres") : null;
          const tone = complete ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
            : failed ? "border-rose-400/30 bg-rose-400/10 text-rose-200"
            : active ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-100"
            : ocrSkipped ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
            : "border-slate-800 bg-slate-950/40 text-slate-400";
          const indicator = active ? "animate-pulse bg-cyan-400 text-slate-950"
            : complete ? "bg-emerald-400 text-slate-950" : "bg-slate-800";
          return (
            <li key={stage} className={"rounded-xl border px-3 py-3 text-xs transition-colors " + tone}>
              <div className="flex items-center gap-3">
                <span className={"grid size-6 shrink-0 place-items-center rounded-full font-mono " + indicator}>{complete ? "✓" : String(index + 1).padStart(2, "0")}</span>
                <span>{label}</span>
              </div>
              {event && <p className="mt-2 pl-9 font-mono text-[10px] opacity-80">
                {ocrSkipped ? t("skipped", "não executado")
                  : event.durationMs !== null ? number.format(event.durationMs) + " ms"
                  : active ? t("in progress", "em andamento")
                  : t("recorded", "registrado")}
                {count && " · " + count}
              </p>}
              {stage === "chunking" && complete && <p className="mt-2 pl-9 leading-relaxed">
                {t("One document can become several searchable passages.", "Um documento pode gerar vários trechos pesquisáveis.")}
              </p>}
              {stage === "ocr" && event && <OcrEventDetails event={event} />}
            </li>
          );
        })}
      </ol>
      {job.error && ocrEvent?.status !== "failed" && <p role="alert" className="mt-4 text-xs text-rose-300">{t("This file could not be processed. Check the file and try again.", "Não foi possível processar este arquivo. Verifique o arquivo e tente novamente.")}</p>}
    </section>
  );
}
