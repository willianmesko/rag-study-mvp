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
}: {
  token?: string | null;
  workspaceId?: string;
  scope: string;
  navigation?: boolean;
}) {
  const client = useQueryClient();
  const userId = useQueryIdentity();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
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
    enabled,
    refetchOnWindowFocus: "always",
    retry: false,
  });
  const messages = useInfiniteQuery({
    queryKey: messagesKey,
    initialPageParam: null as number | null,
    queryFn: ({ signal, pageParam }) =>
      api.conversationMessages(
        token!,
        workspaceId!,
        selectedId!,
        signal,
        pageParam ?? undefined,
      ),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    enabled: enabled && Boolean(selectedId),
    retry: false,
    refetchOnWindowFocus: "always",
    refetchInterval: (query) =>
      enabled && selectedId
        ? query.state.data?.pages[0]?.turns.some(
            (turn) => turn.status === "queued" || turn.status === "running",
          )
          ? 2000
          : 15000
        : false,
  });
  const conversation = messages.data?.pages[0]?.conversation;
  const turns = [...(messages.data?.pages ?? [])]
    .reverse()
    .flatMap((page) => page.turns);
  const conversations =
    list.data?.pages.flatMap((page) => page.conversations) ?? [];
  useEffect(() => {
    if (!navigation) return;
    const onPop = () => {
      if (window.location.pathname === "/ask") setSelectedId(selectedFromUrl());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [navigation]);
  function select(id: string | null, forceNavigation = false) {
    setSelectedId(id);
    setMutationError(null);
    draftId.current = null;
    if (navigation && (forceNavigation || window.location.pathname === "/ask"))
      navigateTo(id ? `/ask?conversation=${encodeURIComponent(id)}` : "/ask");
  }
  async function ensure() {
    if (selectedId) return selectedId;
    if (createPending.current) return createPending.current;
    setCreating(true);
    setMutationError(null);
    draftId.current ??= crypto.randomUUID();
    const task = api
      .createConversation(token!, workspaceId!, draftId.current)
      .then(({ conversation }) => {
        select(conversation.id);
        void client.invalidateQueries({ queryKey: key });
        return conversation.id;
      });
    createPending.current = task;
    try {
      return await task;
    } catch (error) {
      setMutationError(error);
      throw error;
    } finally {
      createPending.current = null;
      setCreating(false);
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
      await client.invalidateQueries({ queryKey: messagesKey });
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
    loading: enabled && Boolean(selectedId) && messages.isPending,
    creating,
    rating,
    error: mutationError ?? messages.error ?? list.error,
    listLoading: list.isPending,
    hasMore: list.hasNextPage,
    loadingMore: list.isFetchingNextPage,
    more: () => void list.fetchNextPage(),
    hasOlder: messages.hasNextPage,
    loadingOlder: messages.isFetchingNextPage,
    older: () => void messages.fetchNextPage(),
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
      if (selectedId) void messages.refetch();
    },
  };
}
