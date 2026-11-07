import type { KnowledgeStatus } from "@rag-study/contracts";
import { useLocale } from "../../../shared/i18n/locale";
import { navigateTo } from "../../../shared/lib/app-route";
import { Mascot } from "../../../shared/ui/Mascot";

export function KnowledgeChatState({ data, loading, failed, demo, canAdd, onAdd, onRetry, compact = false }: {
  data?: KnowledgeStatus; loading: boolean; failed: boolean; demo: boolean;
  canAdd: boolean; onAdd?: () => void; onRetry: () => void; compact?: boolean;
}) {
  const { t } = useLocale();
  const processing = Boolean(data?.processingJobs);
  const needsAttention = !processing && Boolean(data?.failedJobs);
  const title = loading ? t("Checking your documents…", "Conferindo seus documentos…")
    : failed ? t("Let’s check your library", "Vamos conferir seus documentos")
    : processing ? t("Milo is preparing your documents", "O Milo está preparando seus documentos")
    : needsAttention ? t("Your documents need attention", "Seus documentos precisam de atenção")
    : demo ? t("This demo library is empty", "Esta biblioteca de demonstração está vazia")
    : t("Start with your first document", "Comece pelo seu primeiro documento");
  const description = loading ? t("Making sure Milo has sources to answer from.", "Conferindo se o Milo tem fontes para responder.")
    : failed ? t("We couldn’t check whether your documents are ready. Try again before sending a question.", "Não foi possível conferir se seus documentos estão prontos. Tente novamente antes de perguntar.")
    : processing ? t("You can stay here. Questions become available as soon as the first document is ready.", "Você pode continuar aqui. As perguntas serão liberadas assim que o primeiro documento estiver pronto.")
    : needsAttention ? t("No documents are ready to search yet. Open Processing to check what happened.", "Ainda não há documentos prontos para consulta. Abra Processamento para conferir o que aconteceu.")
    : demo ? t("There are no demo sources to consult right now. Sign in to add documents to your own workspace.", "Não há fontes de demonstração para consultar agora. Entre para adicionar documentos ao seu próprio espaço.")
    : canAdd ? t("Add a handbook, a guide or any document you want to explore. Milo will answer using your workspace’s sources.", "Adicione um manual, um guia ou outro documento que queira explorar. O Milo responderá com as fontes do seu espaço.")
    : t("Ask an owner or editor to add documents to this workspace. Once they’re ready, you can ask Milo and explore the sources.", "Peça a um proprietário ou editor para adicionar documentos a este espaço. Quando estiverem prontos, você poderá perguntar ao Milo e explorar as fontes.");

  return <div className={compact ? "shrink-0 border-t border-slate-800 p-4 sm:p-5" : "min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8"}>
    <div className={`mx-auto flex max-w-lg flex-col items-center gap-3 text-center ${compact ? "" : "min-h-full justify-center"}`}>
      {!compact && <div className="mb-1 grid size-24 place-items-center rounded-full bg-cyan-400/5 ring-1 ring-cyan-300/15" aria-hidden="true">
        <Mascot decorative size="sm" className={loading || processing ? "workspace-loading-milo" : ""} />
      </div>}
      <h2 className={`${compact ? "text-base" : "text-xl sm:text-2xl"} font-semibold tracking-tight text-white`} aria-live="polite" aria-atomic="true">{title}</h2>
      <p className="text-sm leading-6 text-slate-300">{description}</p>
      {!loading && <div className="mt-2 flex flex-wrap justify-center gap-3">
        {failed ? <button type="button" className="primary-button" onClick={onRetry}>{t("Try again", "Tentar novamente")}</button>
          : demo ? <button type="button" className="primary-button" onClick={() => navigateTo("/sign-in")}>{t("Sign in", "Entrar")}</button>
          : <>
            {(processing || needsAttention) && <button type="button" className="primary-button" onClick={() => navigateTo("/workspace/processing")}>{t("View processing", "Ver processamento")}</button>}
            {canAdd && <button type="button" className={processing || needsAttention ? "secondary-button" : "primary-button"}
              aria-haspopup={onAdd ? "dialog" : undefined} onClick={onAdd ?? (() => navigateTo("/workspace/knowledge"))}>
              {t("Add documents", "Adicionar documentos")}
            </button>}
          </>}
      </div>}
      {!loading && !failed && !processing && !needsAttention && !demo && canAdd && <p className="mt-1 text-xs leading-5 text-slate-400">
        {t("PDF, Word, text or a public web page. Documents are shared with members of this workspace.", "PDF, Word, texto ou uma página pública. Os documentos ficam disponíveis aos membros deste espaço.")}
      </p>}
    </div>
  </div>;
}
