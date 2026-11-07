import { useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { chatRunIdSchema } from "@rag-study/contracts";
import { api } from "../../../shared/api/rag-api";
import { navigateTo } from "../../../shared/lib/app-route";
import { useQueryIdentity } from "../../../shared/lib/query-identity";
import { privateQueryKey } from "../../../shared/lib/query-keys";
import { useConversationMessages } from "./use-conversation-messages";
import type { ConversationWindow } from "./conversation-window";

function selectedFromUrl() {
  const value = new URLSearchParams(window.location.search).get("conversation");
  const parsed = chatRunIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export function useSavedConversations({
  token,
  workspaceId,
  scope,
  navigation = true,
  observed = true,
  messagesObserved = true,
  readerOwned = false,
}: {
  token?: string | null;
  workspaceId?: string;
  scope: string;
  navigation?: boolean;
  observed?: boolean;
  messagesObserved?: boolean;
  readerOwned?: boolean;
}) {
  const client = useQueryClient();
  const userId = useQueryIdentity();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => api.health(signal),
    staleTime: 10000,
  });
  const enabled = Boolean(
    token && userId && workspaceId && health.data?.capabilities?.durableConversations,
  );
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    navigation ? selectedFromUrl() : null,
  );
  const [creating, setCreating] = useState(false),
    [mutationError, setMutationError] = useState<unknown>(null),
    [rating, setRating] = useState<string | null>(null);
  const selectionEpoch = useRef(0), mounted = useRef(true);
  const routeIdentity = useRef(window.location.pathname + window.location.search);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; selectionEpoch.current++; };
  }, [scope]);
  const createPending = useRef<Promise<string> | null>(null),
    draftId = useRef<string | null>(null);
  const key = privateQueryKey("conversations", userId, workspaceId);
  const messagesKey = privateQueryKey("conversation-messages", userId, workspaceId, selectedId);
  const list = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) =>
      api.conversations(token!, workspaceId!, signal, pageParam ?? undefined),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: enabled && observed,
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
    retry: false,
  });
  const messages = useConversationMessages({ token, workspaceId, userId,
    conversationId: selectedId, enabled, observed: messagesObserved, readerOwned });
  const conversation = messages.data?.conversation;
  const turns = messages.data?.turns ?? [];
  useEffect(() => {
    if (!observed && !client.getQueryCache().find({ queryKey: key, exact: true })?.isActive()) {
      void client.cancelQueries({ queryKey: key, exact: true });
    }
  }, [client, observed, JSON.stringify(key)]);
  const conversations =
    list.data?.pages.flatMap((page) => page.conversations) ?? [];
  useEffect(() => {
    if (!navigation) return;
    const onPop = () => {
      const route = window.location.pathname + window.location.search;
      if (route !== routeIdentity.current) { selectionEpoch.current++; routeIdentity.current = route; }
      if (window.location.pathname === "/ask") setSelectedId(selectedFromUrl());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [navigation]);
  function select(id: string | null, forceNavigation = false) {
    selectionEpoch.current++;
    setSelectedId(id);
    setMutationError(null);
    draftId.current = null;
    if (navigation && (forceNavigation || window.location.pathname === "/ask"))
      navigateTo(id ? `/ask?conversation=${encodeURIComponent(id)}` : "/ask");
  }
  async function ensure(onCreated?: (id: string) => void) {
    if (selectedId) return selectedId;
    if (createPending.current) return createPending.current;
    const epoch = selectionEpoch.current;
    setCreating(true);
    setMutationError(null);
    draftId.current ??= crypto.randomUUID();
    const task = api
      .createConversation(token!, workspaceId!, draftId.current)
      .then(({ conversation }) => {
        if (!mounted.current || selectionEpoch.current !== epoch)
          throw new DOMException("Conversation selection changed.", "AbortError");
        onCreated?.(conversation.id);
        select(conversation.id);
        void client.invalidateQueries({ queryKey: key });
        return conversation.id;
      });
    createPending.current = task;
    try {
      return await task;
    } catch (error) {
      if (mounted.current && selectionEpoch.current === epoch) setMutationError(error);
      throw error;
    } finally {
      if (createPending.current === task) createPending.current = null;
      if (mounted.current) setCreating(false);
    }
  }
  function refresh() {
    void client.invalidateQueries({ queryKey: key });
    void client.invalidateQueries({
      queryKey: privateQueryKey("conversation-messages", userId, workspaceId),
    });
  }
  async function rename(id: string, title: string) {
    setMutationError(null);
    try {
      await api.renameConversation(token!, workspaceId!, id, title);
      refresh();
    } catch (error) {
      setMutationError(error);
      throw error;
    }
  }
  async function remove(id?: string) {
    setMutationError(null);
    try {
      await api.deleteConversation(token!, workspaceId!, id);
      if (!id || id === selectedId) select(null);
      refresh();
    } catch (error) {
      setMutationError(error);
      throw error;
    }
  }
  async function feedback(assistantId: string, value: "up" | "down" | null) {
    if (!selectedId || rating) return;
    setRating(assistantId);
    setMutationError(null);
    try {
      await api.feedbackConversation(
        token!,
        workspaceId!,
        selectedId,
        assistantId,
        value,
      );
      // The server acknowledged the rating. Update the visited record in place;
      // rating an old message must not refetch every old history page.
      await client.cancelQueries({ queryKey: messagesKey, exact: true });
      client.setQueryData<ConversationWindow>(messagesKey, (current) => current && ({
        ...current, turns: current.turns.map((turn) => turn.assistantMessageId === assistantId ? { ...turn, feedback: value } : turn),
      }));
    } catch (error) {
      setMutationError(error);
    } finally {
      setRating(null);
    }
  }
  return {
    enabled,
    initializing: Boolean(
      token && workspaceId && (health.isPending || health.isError),
    ),
    selectedId,
    conversation,
    turns,
    conversations,
    loading: messages.canRead && messages.isPending,
    creating,
    rating,
    error: mutationError ?? (messagesObserved ? messages.error : null) ?? list.error,
    listLoading: enabled && observed && list.isPending,
    hasMore: list.hasNextPage,
    loadingMore: list.isFetchingNextPage,
    more: () => void list.fetchNextPage(),
    hasOlder: messages.hasOlder,
    loadingOlder: messages.loadingOlder,
    older: () => void messages.loadOlder(),
    ensure,
    open: (id: string) => select(id, true),
    newChat: () => select(null),
    rename,
    remove,
    feedback,
    refresh,
    retry: () => {
      setMutationError(null);
      void list.refetch();
      if (selectedId && messages.canRead) messages.retry();
    },
  };
}
