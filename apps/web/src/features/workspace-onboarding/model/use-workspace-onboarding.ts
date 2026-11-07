import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WorkspaceOnboardingProgress } from "@rag-study/contracts";
import { api } from "../../../shared/api/rag-api";
import { initialProgress, readOnboarding, sameProgress, shouldSyncOnboarding, storeOnboarding, type LocalOnboarding } from "./onboarding-progress";

const localKey = (userId?: string, workspaceId?: string) => ["local-onboarding", userId, workspaceId] as const;
const remoteKey = (userId?: string, workspaceId?: string) => ["workspace-onboarding", userId, workspaceId] as const;

type Scope = { userId: string; workspaceId: string; accessToken: string };

export function useWorkspaceOnboarding(userId?: string, workspaceId?: string, accessToken?: string) {
  const queryClient = useQueryClient();
  const enabled = Boolean(userId && workspaceId && accessToken);
  const local = useQuery({
    queryKey: localKey(userId, workspaceId), enabled: false, structuralSharing: false,
    queryFn: () => readOnboarding(userId, workspaceId), initialData: () => readOnboarding(userId, workspaceId)
  }).data;
  const remote = useQuery({
    queryKey: remoteKey(userId, workspaceId), enabled, retry: false, networkMode: "always",
    staleTime: 10_000, refetchOnReconnect: "always",
    queryFn: ({ signal }) => api.getOnboardingProgress(workspaceId!, accessToken!, signal)
  });

  function setLocal(scope: Pick<Scope, "userId" | "workspaceId">, snapshot: LocalOnboarding) {
    storeOnboarding(scope.userId, scope.workspaceId, snapshot);
    queryClient.setQueryData(localKey(scope.userId, scope.workspaceId), snapshot);
  }

  const { mutate, reset, isPending, isError, variables } = useMutation({
    mutationFn: ({ scope, snapshot }: { scope: Scope; snapshot: LocalOnboarding }) =>
      api.saveOnboardingProgress(scope.workspaceId, scope.accessToken, snapshot.progress),
    networkMode: "always",
    async onSuccess(progress, { scope, snapshot }) {
      const key = remoteKey(scope.userId, scope.workspaceId);
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      queryClient.setQueryData(key, progress);
      if (queryClient.getQueryData(localKey(scope.userId, scope.workspaceId)) === snapshot) {
        setLocal(scope, { progress, pending: null });
      }
    }
  });

  const pending = shouldSyncOnboarding(local, remote.data);
  const progress = pending || remote.data === undefined ? local.progress : remote.data ?? initialProgress;
  const currentWrite = variables?.snapshot === local;

  useEffect(() => {
    if (!userId || !workspaceId || !accessToken || !remote.isFetched || isPending) return;
    const scope = { userId, workspaceId, accessToken };
    if (pending) {
      if (!currentWrite) mutate({ scope, snapshot: local });
    } else if (remote.data !== undefined && (local.pending || !sameProgress(local.progress, progress))) {
      setLocal(scope, { progress, pending: null });
    }
  }, [userId, workspaceId, accessToken, remote.isFetched, remote.data, isPending, pending, currentWrite, local, progress, mutate]);

  useEffect(() => {
    if (!enabled || !isError || !currentWrite) return;
    window.addEventListener("online", reset);
    return () => window.removeEventListener("online", reset);
  }, [enabled, isError, currentWrite, reset]);

  function update(changes: Partial<WorkspaceOnboardingProgress>) {
    if (!userId || !workspaceId) return;
    const next = { ...progress, ...changes };
    if (!sameProgress(next, progress)) setLocal({ userId, workspaceId }, { progress: next, pending: "edit" });
  }

  function retry() {
    if (remote.isError) void remote.refetch();
    if (currentWrite && isError) reset();
  }

  return {
    progress, update, retry,
    loading: enabled && remote.isPending,
    syncing: pending && (isPending || !currentWrite) && remote.isFetched,
    syncFailed: pending ? isError && currentWrite : remote.isError && !progress.completed
  };
}
