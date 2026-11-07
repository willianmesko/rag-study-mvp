import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../shared/api/rag-api";
import { privateQueryKey } from "../../../shared/lib/query-keys";
import { appendOlderMessages, refreshConversationWindow, type ConversationWindow } from "./conversation-window";

export function useConversationMessages(input: {
  token?: string | null; workspaceId?: string; userId: string | null;
  conversationId: string | null; enabled: boolean; observed: boolean; readerOwned: boolean;
}) {
  const { token, workspaceId, userId, conversationId, enabled, observed, readerOwned } = input;
  const client = useQueryClient();
  const key = privateQueryKey("conversation-messages", userId, workspaceId, conversationId);
  const scope = JSON.stringify(key);
  const older = useRef<AbortController | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<unknown>(null);
  const canBrowse = enabled && observed && Boolean(conversationId);
  const canRead = canBrowse && !readerOwned;
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => {
      const bounded = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
      return refreshConversationWindow(conversationId!, client.getQueryData<ConversationWindow>(key),
        (before, limit) => api.conversationMessages(token!, workspaceId!, conversationId!, bounded, before, limit), bounded);
    },
    enabled: canRead && !loadingOlder,
    // Appending an old page is fresh data, not a reason to reread the head.
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchInterval: (query) => query.state.status === "error" ? false
      : query.state.data?.turns.some((turn) => turn.status === "queued" || turn.status === "running") ? 2_000 : 15_000,
  });

  useEffect(() => {
    // Disabling an observer alone does not abort an already running fetch.
    // Respect any other active observer (for example Milo's guide).
    if (!canRead && !client.getQueryCache().find({ queryKey: key, exact: true })?.isActive()) {
      void client.cancelQueries({ queryKey: key, exact: true });
    }
  }, [client, scope, canRead]);
  useEffect(() => {
    setOlderError(null);
    setLoadingOlder(false);
    if (observed) void client.invalidateQueries({ queryKey: key, exact: true }, { cancelRefetch: false });
    return () => { older.current?.abort(); older.current = null; };
  }, [client, scope, observed]);

  async function loadOlder() {
    if (!canBrowse || older.current) return;
    const controller = new AbortController();
    older.current = controller;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      await client.cancelQueries({ queryKey: key, exact: true });
      const before = client.getQueryData<ConversationWindow>(key)?.nextBefore;
      if (!before) return;
      const page = await api.conversationMessages(token!, workspaceId!, conversationId!, controller.signal, before);
      controller.signal.throwIfAborted();
      client.setQueryData<ConversationWindow>(key, (current) => current ? appendOlderMessages(current, page, before) : undefined);
    } catch (error) {
      if (!controller.signal.aborted) setOlderError(error);
    } finally {
      if (older.current === controller) { older.current = null; setLoadingOlder(false); }
    }
  }
  return {
    ...query, key, canRead,
    error: olderError ?? query.error,
    loadingOlder,
    hasOlder: Boolean(query.data?.nextBefore),
    loadOlder,
    retry: () => { setOlderError(null); void query.refetch(); },
  };
}
