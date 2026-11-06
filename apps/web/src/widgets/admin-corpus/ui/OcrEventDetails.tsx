import type { IngestionEvent } from "../../../shared/api/rag-api";
import { useLocale, type Translate } from "../../../shared/i18n/locale";

function ocrFailureMessage(code: unknown, t: Translate) {
  switch (code) {
    case "ocr_disabled":
      return t("OCR is disabled. Ask your administrator to enable it, or upload a searchable PDF.",
        "O OCR está desativado. Peça à administração para ativá-lo ou envie um PDF pesquisável.");
    case "ocr_page_limit":
      return t("This scan has too many pages for OCR. Split it into smaller PDFs and upload them separately.",
        "O arquivo tem páginas demais para OCR. Divida-o em PDFs menores e envie-os separadamente.");
    case "ocr_no_text":
      return t("OCR found no readable text. Try a clearer scan or upload a searchable PDF.",
        "O OCR não encontrou texto legível. Tente uma digitalização mais nítida ou envie um PDF pesquisável.");
    case "ocr_unavailable":
      return t("OCR is unavailable. Try again later or upload a searchable PDF.",
        "O OCR está indisponível. Tente novamente mais tarde ou envie um PDF pesquisável.");
    case "ocr_timeout":
      return t("OCR took too long. Split the scan into smaller PDFs and try again.",
        "O OCR excedeu o tempo limite. Divida o arquivo em PDFs menores e tente novamente.");
    case "ocr_render_failed":
      return t("The scanned pages could not be opened. Export the PDF again and upload it.",
        "Não foi possível abrir as páginas digitalizadas. Exporte o PDF novamente e envie-o.");
    case "ocr_recognition_failed":
      return t("OCR could not read the scanned pages. Try a clearer scan or upload a searchable PDF.",
        "O OCR não conseguiu ler as páginas digitalizadas. Tente uma digitalização mais nítida ou envie um PDF pesquisável.");
    case "ocr_output_limit":
      return t("This scan exceeded the OCR processing limits. Upload a smaller scan or a searchable PDF.",
        "O arquivo excedeu os limites de processamento do OCR. Envie um arquivo menor ou um PDF pesquisável.");
    default:
      return t("OCR could not finish. Try a clearer scan or upload a searchable PDF.",
        "O OCR não foi concluído. Tente uma digitalização mais nítida ou envie um PDF pesquisável.");
  }
}

function ocrCount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function OcrEventDetails({ event }: { event: IngestionEvent }) {
  const { locale, t } = useLocale();
  if (event.status === "failed") {
    return <p role="alert" className="mt-2 break-words leading-relaxed">{ocrFailureMessage(event.details.code, t)}</p>;
  }
  if (event.status === "info") {
    return event.details.code === "ocr_disabled" ? (
      <p role="status" className="mt-2 break-words leading-relaxed">
        {t("The text already in the PDF is used for indexing. OCR is disabled, so the scanned pages were skipped.",
          "O texto que já existe no PDF segue para indexação. Como o OCR está desativado, as páginas digitalizadas ficaram sem reconhecimento de texto.")}
      </p>
    ) : null;
  }

  const active = event.status === "started";
  const number = new Intl.NumberFormat(locale);
  const total = ocrCount(event.details.totalPages);
  const pages = ocrCount(active ? event.details.requestedPages : event.details.ocrPages);
  const words = ocrCount(event.details.wordCount);
  const emptyPages = ocrCount(event.details.emptyPages);
  const confidence = event.details.meanConfidence;
  const confidenceLabel = typeof confidence === "number" && Number.isFinite(confidence) && confidence >= 0 && confidence <= 100
    ? new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(confidence / 100)
    : null;

  return (
    <div aria-live="polite" className="mt-2 space-y-1 leading-relaxed">
      {pages !== null && <p>
        {active ? t("Pages to read", "Páginas para leitura") : t("Pages processed by OCR", "Páginas processadas pelo OCR")}
        {" · "}{number.format(pages)}
        {total !== null && " " + t("of", "de") + " " + number.format(total)}
      </p>}
      {!active && words !== null && <p>{t("Words recognized", "Palavras reconhecidas")} · {number.format(words)}</p>}
      {!active && emptyPages !== null && emptyPages > 0 && (
        <p className="text-amber-200">{t("Pages with no detected text", "Páginas sem texto detectado")} · {number.format(emptyPages)}</p>
      )}
      {!active && confidenceLabel && <p>{t("OCR confidence estimate", "Estimativa de confiança do OCR")} · {confidenceLabel}</p>}
      {!active && (confidenceLabel || (emptyPages !== null && emptyPages > 0)) && <p className="text-slate-300">
        {t("Check the original scan to verify the extracted text.", "Confira a digitalização original para verificar o texto extraído.")}
      </p>}
    </div>
  );
}
