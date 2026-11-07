import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorkspaceOnboarding } from "../features/workspace-onboarding/index";
import { SignInPage } from "../pages/sign-in/index";
import { api, type Workspace } from "../shared/api/rag-api";
import { demoAvailable, canIndexDemo } from "../shared/config/product-mode";
import { useLocale } from "../shared/i18n/locale";
import { conversationPath, documentFiltersFromLocation, knowledgePath, navigateTo, readAppRoute } from "../shared/lib/app-route";
import { readBrowserValue, writeBrowserValue } from "../shared/lib/browser-storage";
import { QueryIdentityProvider } from "../shared/lib/query-identity";
import { privateQueryKey } from "../shared/lib/query-keys";
import { lazyWithRecovery } from "../shared/ui/SectionErrorBoundary";
import { useApplicationLocation } from "./model/use-application-location";
import { useApplicationSession } from "./model/use-application-session";
import { accessibleWorkspacePath, canViewRoute } from "./model/route-policy";
import { ApplicationStatus } from "./ui/ApplicationStatus";

const RagLabPage = lazyWithRecovery(async () => ({ default: (await import("../pages/rag-lab/index")).RagLabPage }), "application");
const OnboardingPage = lazyWithRecovery(async () => ({ default: (await import("../pages/onboarding/index")).OnboardingPage }), "onboarding");
const McpConsentPage = lazyWithRecovery(async () => ({ default: (await import("../pages/mcp-consent/index")).McpConsentPage }), "consent");
const overviewPath = "/workspace/overview";
const askPath = "/ask";

export function ApplicationRouter() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const pathname = useApplicationLocation();
  const [selected, setSelected] = useState<{ userId: string; workspaceId: string } | null>(null);
  const [createdSetup, setCreatedSetup] = useState<string | null>(null);
  const returnPath = useRef<string | null>(null);
  const resetPrivateSelection = useCallback(() => {
    setSelected(null);
    setCreatedSetup(null);
  }, []);
  const { session, authReady, acceptSession, signingOut, signOutError, signOut: endSession } = useApplicationSession(resetPrivateSelection);
  const route = readAppRoute(pathname);
  const demoRoute = route.kind === "demo" && demoAvailable && (route.lab.tab !== "ingest" || canIndexDemo);
  const token = session?.access_token;
  const userId = session?.user.id;
  const workspaceQueryKey = privateQueryKey("workspaces", userId);
  const workspaceQuery = useQuery({
    queryKey: workspaceQueryKey,
    queryFn: ({ signal }) => api.workspaces(token!, signal),
    enabled: Boolean(token && !demoRoute)
  });
  const workspaces = workspaceQuery.data?.workspaces ?? [];
  const rememberedWorkspaceId = userId && selected && selected.userId === userId
    ? selected.workspaceId
    : userId ? readBrowserValue(`lumora-workspace:${userId}`) : null;
  const activeWorkspace = workspaces.find((workspace) => workspace.tenantId === rememberedWorkspaceId) ?? workspaces[0];
  const activeRole = activeWorkspace?.role;
  const activeSetup = userId && activeWorkspace ? `${userId}:${activeWorkspace.tenantId}` : null;
  const onboarding = useWorkspaceOnboarding(userId, activeWorkspace?.tenantId, demoRoute ? undefined : token);
  const setupComplete = onboarding.progress.completed;
  const setupLoading = onboarding.loading && !setupComplete;

  useEffect(() => {
    if (demoRoute || !authReady || route.kind === "mcp-consent") return;
    if (!session) {
      if (route.kind === "private") returnPath.current = pathname;
      navigateTo("/sign-in", { replace: true });
    } else if (workspaceQuery.isSuccess && !workspaceQuery.isError && !setupLoading) {
      const requestedPath = route.kind === "private" ? pathname : returnPath.current;
      const requestedRoute = readAppRoute(requestedPath ?? "/");
      const openingConnections = requestedRoute.kind === "private" && requestedRoute.lab.tab === "connections";
      if (!setupComplete && !openingConnections) {
        if (route.kind === "private") returnPath.current = pathname;
        navigateTo("/onboarding", { replace: true });
      } else if (activeRole) {
        const next = accessibleWorkspacePath(requestedPath, activeRole);
        returnPath.current = null;
        navigateTo(next, { replace: true });
      }
    }
  }, [activeRole, authReady, demoRoute, pathname, route.kind, session, setupComplete, setupLoading, workspaceQuery.isSuccess, workspaceQuery.isError]);

  function selectWorkspace(workspaceId: string) {
    if (!userId) return;
    if (route.kind === "private" && route.lab.tab === "answer" && new URLSearchParams(window.location.search).has("conversation")) navigateTo(askPath, { replace: true });
    else if (route.kind === "private" && route.lab.tab === "admin" && route.lab.workspaceSection === "knowledge") {
      const filters = documentFiltersFromLocation(pathname);
      if (filters.documentId) navigateTo(knowledgePath({ ...filters, documentId: undefined }), { replace: true });
    }
    setSelected({ userId, workspaceId });
    setCreatedSetup(null);
    writeBrowserValue(`lumora-workspace:${userId}`, workspaceId);
  }

  function workspaceCreated(workspace: Workspace) {
    if (!userId || !token) return;
    void queryClient.cancelQueries({ queryKey: workspaceQueryKey, exact: true });
    queryClient.setQueryData<{ workspaces: Workspace[] }>(workspaceQueryKey, (current) => ({
      workspaces: [...(current?.workspaces ?? []).filter((item) => item.tenantId !== workspace.tenantId), workspace]
    }));
    selectWorkspace(workspace.tenantId);
    setCreatedSetup(`${userId}:${workspace.tenantId}`);
  }

  function finishOnboarding(conversationId?:string) {
    if (!activeSetup) return;
    onboarding.update({ goal:onboarding.progress.goal??"knowledge", step:"answer", completed: true });
    setCreatedSetup(null);
    returnPath.current = null;
    navigateTo(conversationPath(conversationId ?? null), { replace: true });
  }

  async function signOut() {
    if (await endSession()) {
      returnPath.current = null;
      navigateTo("/sign-in", { replace: true });
    }
  }

  const loadingText = t("Opening Lumora…", "Abrindo o Lumora…");
  const signOutMessage = signOutError ? t("We could not sign you out. Try again.", "Não conseguimos sair da sua conta. Tente novamente.") : null;

  if (demoRoute && route.kind === "demo") {
    return <Suspense fallback={<ApplicationStatus message={loadingText} />}><RagLabPage key="demo" scope="demo" lab={route.lab} accountAction={{
      label: session ? t("My workspace", "Meu espaço de trabalho") : t("Sign in", "Entrar"),
      onClick: () => navigateTo(session ? overviewPath : "/sign-in")
    }} /></Suspense>;
  }
  if (!authReady) return <ApplicationStatus message={loadingText} />;
  if (!session || !token || !userId) {
    return <SignInPage demoAvailable={demoAvailable} onSuccess={acceptSession}
      onDemo={() => navigateTo("/demo")} />;
  }
  if (workspaceQuery.isError) {
    return <ApplicationStatus message={signOutMessage ?? t("We could not load your workspaces.", "Não conseguimos carregar seus espaços de trabalho.")}
      onRetry={() => void workspaceQuery.refetch()} onSignOut={() => void signOut()} />;
  }
  if (workspaceQuery.isPending) return <ApplicationStatus message={t("Loading your workspaces…", "Carregando seus espaços de trabalho…")} />;
  if (route.kind === "mcp-consent") return <QueryIdentityProvider userId={userId}><Suspense fallback={<ApplicationStatus message={loadingText} />}>
    <McpConsentPage key={route.requestId} requestId={route.requestId} token={token} workspaces={workspaces} />
  </Suspense></QueryIdentityProvider>;
  if (setupLoading) return <ApplicationStatus message={t("Checking your progress with Milo…", "Consultando seu progresso com o Milo…")} />;

  if (!activeWorkspace || (!setupComplete && !(route.kind === "private" && route.lab.tab === "connections"))) {
    return <QueryIdentityProvider userId={userId}><Suspense fallback={<ApplicationStatus message={loadingText} />}>
      <OnboardingPage key={userId} workspace={activeWorkspace} workspaces={workspaces} accessToken={token} userId={userId}
        progress={onboarding.progress} syncing={onboarding.syncing} syncFailed={onboarding.syncFailed}
        onProgress={onboarding.update} onRetrySync={onboarding.retry}
        justCreated={activeSetup !== null && activeSetup === createdSetup} onWorkspaceCreated={workspaceCreated}
        onWorkspaceChange={selectWorkspace} onComplete={finishOnboarding} onSignOut={() => void signOut()} />
      {signOutMessage && <p className="error-message fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md" role="alert">{signOutMessage}</p>}
    </Suspense></QueryIdentityProvider>;
  }

  const lab = route.kind === "private" && canViewRoute(route.lab, activeWorkspace.role) ? route.lab : { tab: "answer" } as const;
  const scope = `${userId}:${activeWorkspace.tenantId}`;
  return <QueryIdentityProvider userId={userId}><Suspense fallback={<ApplicationStatus message={loadingText} />}><RagLabPage key={scope} scope={scope} lab={lab}
    privateArea={{ token, workspace: activeWorkspace, workspaces, guideProgress: onboarding.progress, onWorkspaceChange: selectWorkspace, onWorkspaceCreated: workspaceCreated }}
    accountAction={{ label: signingOut ? t("Signing out…", "Saindo…") : t("Sign out", "Sair"), onClick: () => void signOut(), disabled: signingOut }}
    accountError={signOutMessage} onboardingSyncing={onboarding.syncing}
    onRetryOnboardingSync={onboarding.syncFailed && !onboarding.syncing ? onboarding.retry : undefined} /></Suspense></QueryIdentityProvider>;
}
