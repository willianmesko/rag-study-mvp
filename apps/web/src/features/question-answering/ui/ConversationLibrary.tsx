import { useState } from "react";
import type { useSavedConversations } from "../model/use-saved-conversations";
import { Overlay } from "../../../shared/ui/Overlay";
import { useLocale } from "../../../shared/i18n/locale";

export function ConversationLibrary({
  saved,
  onOpen,
  onClose,
  standalone = false,
}: {
  saved: ReturnType<typeof useSavedConversations>;
  onOpen: (id: string) => void;
  onClose?: () => void;
  standalone?: boolean;
}) {
  const { t, locale } = useLocale();
  const [editing, setEditing] = useState<string | null>(null),
    [title, setTitle] = useState(""),
    [deleting, setDeleting] = useState<string | null>(null),
    [pending, setPending] = useState(false);
  const contents = (
    <div className="space-y-5">
      <p className="text-sm leading-6 text-slate-400">
        {t(
          "Private to you in this workspace. Conversations are saved across devices for 90 days after the last message.",
          "Privadas para você neste espaço. As conversas ficam salvas entre dispositivos por 90 dias após a última mensagem.",
        )}
      </p>
      {saved.listLoading ? (
        <p role="status" className="empty-state">
          {t("Loading your conversations…", "Carregando suas conversas…")}
        </p>
      ) : saved.conversations.length === 0 ? (
        <p className="empty-state">
          {t(
            "Your saved conversations will appear here after you send a message.",
            "Suas conversas salvas vão aparecer aqui depois que você enviar uma mensagem.",
          )}
        </p>
      ) : (
        <ul className="divide-y divide-slate-800">
          {saved.conversations.map((conversation) => (
            <li key={conversation.id} className="py-4">
              {editing === conversation.id ? (
                <form
                  className="flex flex-wrap gap-2"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (!title.trim() || pending) return;
                    setPending(true);
                    try {
                      await saved.rename(conversation.id, title.trim());
                      setEditing(null);
                    } catch {
                    } finally {
                      setPending(false);
                    }
                  }}
                >
                  <label className="min-w-0 flex-1 text-sm">
                    {t("Conversation name", "Nome da conversa")}
                    <input
                      autoFocus
                      className="field mt-2"
                      maxLength={120}
                      required
                      value={title}
                      disabled={pending}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </label>
                  <div className="flex items-end gap-2">
                    <button
                      className="primary-button"
                      disabled={pending || !title.trim()}
                      type="submit"
                    >
                      {t("Save name", "Salvar nome")}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={pending}
                      type="button"
                      onClick={() => setEditing(null)}
                    >
                      {t("Cancel", "Cancelar")}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex min-w-0 flex-wrap items-start gap-3">
                  <button
                    className="min-h-11 min-w-0 flex-1 rounded-lg px-2 py-1 text-left transition-colors hover:bg-slate-800"
                    type="button"
                    onClick={() => {
                      onOpen(conversation.id);
                      onClose?.();
                    }}
                  >
                    <span className="block break-words font-medium text-slate-100">
                      {conversation.title ??
                        t("New conversation", "Nova conversa")}
                    </span>
                    <span className="mt-1 block text-xs text-slate-400">
                      {new Date(conversation.updatedAt).toLocaleDateString(
                        locale,
                      )}{" "}
                      · {(conversation.turnCount * 2).toLocaleString(locale)}{" "}
                      {t("messages", "mensagens")}
                    </span>
                  </button>
                  <div className="flex gap-1">
                    <button
                      className="text-action min-h-11 px-2"
                      type="button"
                      aria-label={t(
                        `Rename ${conversation.title ?? "conversation"}`,
                        `Renomear ${conversation.title ?? "conversa"}`,
                      )}
                      onClick={() => {
                        setEditing(conversation.id);
                        setTitle(conversation.title ?? "");
                        setDeleting(null);
                      }}
                    >
                      {t("Rename", "Renomear")}
                    </button>
                    <button
                      className="text-action min-h-11 px-2 text-rose-300"
                      type="button"
                      aria-label={t(
                        `Delete ${conversation.title ?? "conversation"}`,
                        `Excluir ${conversation.title ?? "conversa"}`,
                      )}
                      onClick={() => {
                        setDeleting(conversation.id);
                        setEditing(null);
                      }}
                    >
                      {t("Delete", "Excluir")}
                    </button>
                  </div>
                </div>
              )}
              {deleting === conversation.id && (
                <div className="mt-3 space-y-3 rounded-xl border border-rose-400/25 p-3">
                  <p className="text-sm text-slate-200">
                    {t(
                      "Permanently delete this conversation, its answers, citations and feedback?",
                      "Excluir permanentemente esta conversa, suas respostas, citações e avaliações?",
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="primary-button"
                      disabled={pending}
                      onClick={async () => {
                        setPending(true);
                        try {
                          await saved.remove(conversation.id);
                          setDeleting(null);
                        } catch {
                        } finally {
                          setPending(false);
                        }
                      }}
                    >
                      {pending
                        ? t("Deleting…", "Excluindo…")
                        : t("Delete conversation", "Excluir conversa")}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={pending}
                      onClick={() => setDeleting(null)}
                    >
                      {t("Keep conversation", "Manter conversa")}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {saved.error && (
        <div className="error-message" role="alert">
          {t(
            "We could not update your conversations. Check your connection and try again.",
            "Não conseguimos atualizar suas conversas. Confira sua conexão e tente novamente.",
          )}{" "}
          <button className="text-action" type="button" onClick={saved.retry}>
            {t("Try again", "Tentar novamente")}
          </button>
        </div>
      )}
      {saved.hasMore && (
        <button
          type="button"
          className="secondary-button"
          disabled={saved.loadingMore}
          onClick={saved.more}
        >
          {saved.loadingMore
            ? t("Loading…", "Carregando…")
            : t("More conversations", "Mais conversas")}
        </button>
      )}
    </div>
  );
  return standalone ? (
    <section className="space-y-5">
      <h1 className="text-2xl font-semibold">
        {t("Your conversations", "Suas conversas")}
      </h1>
      {contents}
    </section>
  ) : (
    <Overlay
      title={t("Your conversations", "Suas conversas")}
      onClose={() => {
        if (!pending) onClose?.();
      }}
      pending={pending}
      side
    >
      {contents}
    </Overlay>
  );
}
