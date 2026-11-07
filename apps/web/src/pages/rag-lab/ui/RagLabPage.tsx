import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import type { QuestionHistoryEntry } from "../../../entities/question/model/history";
import { DocumentIngestionForm } from "../../../features/document-ingestion/ui/DocumentIngestionForm";
import { useConversation } from "../../../features/question-answering/model/use-conversation";
import { QuestionAnswerForm } from "../../../features/question-answering/ui/QuestionAnswerForm";
import { QuestionHistoryPanel } from "../../../features/question-history/ui/QuestionHistoryPanel";
import { SemanticSearchForm } from "../../../features/semantic-search/ui/SemanticSearchForm";
import { useWorkspaceOnboarding } from "../../../features/workspace-onboarding/model/use-workspace-onboarding";
import { OnboardingSyncNotice } from "../../../features/workspace-onboarding/ui/OnboardingSyncNotice";
import { SignInPage } from "../../sign-in/ui/SignInPage";
import { api, type QuestionSource, type Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { canAccessWorkspaceSection, navigateTo, pathForTab, readAppRoute, type LabRoute } from "../../../shared/lib/app-route";
import { supabase } from "../../../shared/lib/supabase";
import { Mascot } from "../../../shared/ui/Mascot";
import { SourcePreview } from "../../../shared/ui/SourcePreview";
import { LabHeader } from "../../../widgets/lab-layout/ui/LabHeader";
import { LabNavigation } from "../../../widgets/lab-layout/ui/LabNavigation";
import { RagLearningAside } from "../../../widgets/lab-layout/ui/RagLearningAside";
import { WorkspaceSwitcher } from "../../../widgets/lab-layout/ui/WorkspaceSwitcher";

const OnboardingPage = lazy(() => import("../../onboarding/ui/OnboardingPage").then(({ OnboardingPage }) => ({ default: OnboardingPage })));
const WorkspaceControlCenter = lazy(() => import("../../../widgets/workspace-control-center/ui/WorkspaceControlCenter").then(({ WorkspaceControlCenter }) => ({ default: WorkspaceControlCenter })));
const overviewPath = "/workspace/overview";
const publicDemo = import.meta.env.VITE_DEMO_MODE === "true";
const canIndexDemo = import.meta.env.DEV && !publicDemo;
const demoAvailable = publicDemo || import.meta.env.DEV;

function canViewRoute(lab: LabRoute, role: Workspace["role"]): boolean {
  return lab.tab !== "admin" || canAccessWorkspaceSection(lab.workspaceSection, role);
}

function accessibleWorkspacePath(path: string | null, role: Workspace["role"]): string {
  if (!path) return overviewPath;
  const route = readAppRoute(path);
  return route.kind === "private" && canViewRoute(route.lab, role) ? path : overviewPath;
}

function readLocal(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function saveLocal(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* Storage is optional. */ }
}

function readQuestionHistory(key: string): QuestionHistoryEntry[] {
  try {
    const entries: unknown = JSON.parse(readLocal(key) ?? "[]");
    return Array.isArray(entries) ? entries as QuestionHistoryEntry[] : [];
  } catch {
    return [];
  }
}

function StatusScreen({ message, onRetry, onSignOut }: { message: string; onRetry?: () => void; onSignOut?: () => void }) {
  const { t } = useLocale();
  return (
    <main className="app-shell grid min-h-svh place-items-center p-5">
      <section className={`panel w-full max-w-md${onRetry ? "" : " text-center"}`}>
        {!onRetry && <div className="mx-auto mb-5 grid size-28 place-items-center rounded-full bg-cyan-400/5 ring-1 ring-cyan-300/15" aria-hidden="true">
          <Mascot size="sm" className="workspace-loading-milo" decorative />
        </div>}
        <p className="eyebrow">Lumora</p>
        <p className="mt-2 text-slate-200" role={onRetry ? "alert" : "status"}>{message}</p>
        {onRetry && <div className="mt-5 flex flex-wrap gap-3">
          <button className="primary-button" type="button" onClick={onRetry}>{t("Try again", "Tentar novamente")}</button>
          {onSignOut && <button className="secondary-button" type="button" onClick={onSignOut}>{t("Sign out", "Sair")}</button>}
        </div>}
      </section>
    </main>
  );
}

export function RagLabPage() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [selected, setSelected] = useState<{ userId: string; workspaceId: string } | null>(null);
  const [createdSetup, setCreatedSetup] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const returnPath = useRef<string | null>(null);
  const route = readAppRoute(pathname);
  const demoRoute = route.kind === "demo" && demoAvailable && (route.lab.tab !== "ingest" || canIndexDemo);
  const token = session?.access_token;
  const userId = session?.user.id;
  const workspaceQueryKey = ["workspaces", token] as const;
  const workspaceQuery = useQuery({
    queryKey: workspaceQueryKey,
    queryFn: () => api.workspaces(token!),
    enabled: Boolean(token && !demoRoute)
  });
  const workspaces = workspaceQuery.data?.workspaces ?? [];
  const rememberedWorkspaceId = userId && selected && selected.userId === userId
    ? selected.workspaceId
    : userId ? readLocal(`lumora-workspace:${userId}`) : null;
  const activeWorkspace = workspaces.find((workspace) => workspace.tenantId === rememberedWorkspaceId) ?? workspaces[0];
  const activeRole = activeWorkspace?.role;
  const activeSetup = userId && activeWorkspace ? `${userId}:${activeWorkspace.tenantId}` : null;
  const onboarding = useWorkspaceOnboarding(userId, activeWorkspace?.tenantId, demoRoute ? undefined : token);
  const setupComplete = onboarding.progress.completed;
  const setupLoading = onboarding.loading && !setupComplete;

  useEffect(() => {
    const update = () => {
      setPathname(window.location.pathname);
      window.scrollTo(0, 0);
    };
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  useEffect(() => {
    const listener = supabase?.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
    });
    return () => listener?.data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (demoRoute || !authReady) return;
    if (!session) {
      if (route.kind === "private") returnPath.current = pathname;
      navigateTo("/sign-in", { replace: true });
    } else if (workspaceQuery.isSuccess && !workspaceQuery.isError && !setupLoading) {
      if (!setupComplete) {
        if (route.kind === "private") returnPath.current = pathname;
        navigateTo("/onboarding", { replace: true });
      } else if (activeRole) {
        const next = accessibleWorkspacePath(route.kind === "private" ? pathname : returnPath.current, activeRole);
        returnPath.current = null;
        navigateTo(next, { replace: true });
      }
    }
  }, [activeRole, authReady, demoRoute, pathname, route.kind, session, setupComplete, setupLoading, workspaceQuery.isSuccess, workspaceQuery.isError]);

  function selectWorkspace(workspaceId: string) {
    if (!userId) return;
    setSelected({ userId, workspaceId });
    setCreatedSetup(null);
    saveLocal(`lumora-workspace:${userId}`, workspaceId);
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

  function finishOnboarding() {
    if (!activeSetup) return;
    onboarding.update({ completed: true });
    setCreatedSetup(null);
    returnPath.current = null;
    navigateTo(overviewPath, { replace: true });
  }

  async function signOut() {
    if (!supabase || signingOut) return;
    setSigningOut(true);
    setSignOutError(false);
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      setSession(null);
      setSelected(null);
      setCreatedSetup(null);
      returnPath.current = null;
      navigateTo("/sign-in", { replace: true });
    } catch {
      setSignOutError(true);
    } finally {
      setSigningOut(false);
    }
  }

  const loadingText = t("Opening Lumora…", "Abrindo o Lumora…");
  const signOutMessage = signOutError ? t("We could not sign you out. Try again.", "Não conseguimos sair da sua conta. Tente novamente.") : null;

  if (demoRoute && route.kind === "demo") {
    return <LabExperience key="demo" scope="demo" lab={route.lab} accountAction={{
      label: session ? t("My workspace", "Meu espaço de trabalho") : t("Sign in", "Entrar"),
      onClick: () => navigateTo(session ? overviewPath : "/sign-in")
    }} />;
  }
  if (!authReady) return <StatusScreen message={loadingText} />;
  if (!session || !token || !userId) {
    return <SignInPage demoAvailable={demoAvailable} onSuccess={setSession}
      onDemo={() => navigateTo(canIndexDemo ? "/demo/index" : "/demo")} />;
  }
  if (workspaceQuery.isError) {
    return <StatusScreen message={signOutMessage ?? t("We could not load your workspaces.", "Não conseguimos carregar seus espaços de trabalho.")}
      onRetry={() => void workspaceQuery.refetch()} onSignOut={() => void signOut()} />;
  }
  if (workspaceQuery.isPending) return <StatusScreen message={t("Loading your workspaces…", "Carregando seus espaços de trabalho…")} />;
  if (setupLoading) return <StatusScreen message={t("Checking your progress with Milo…", "Consultando seu progresso com o Milo…")} />;

  if (!activeWorkspace || !setupComplete) {
    return <Suspense fallback={<StatusScreen message={loadingText} />}>
      <OnboardingPage key={userId} workspace={activeWorkspace} workspaces={workspaces} accessToken={token} userId={userId}
        progress={onboarding.progress} syncing={onboarding.syncing} syncFailed={onboarding.syncFailed}
        onProgress={onboarding.update} onRetrySync={onboarding.retry}
        justCreated={activeSetup !== null && activeSetup === createdSetup} onWorkspaceCreated={workspaceCreated}
        onWorkspaceChange={selectWorkspace} onComplete={finishOnboarding} onSignOut={() => void signOut()} />
      {signOutMessage && <p className="error-message fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md" role="alert">{signOutMessage}</p>}
    </Suspense>;
  }

  const lab = route.kind === "private" && canViewRoute(route.lab, activeWorkspace.role) ? route.lab : { tab: "admin", workspaceSection: "overview" } as const;
  const scope = `${userId}:${activeWorkspace.tenantId}`;
  return <LabExperience key={scope} scope={scope} lab={lab}
    privateArea={{ token, workspace: activeWorkspace, workspaces, onWorkspaceChange: selectWorkspace, onWorkspaceCreated: workspaceCreated }}
    accountAction={{ label: signingOut ? t("Signing out…", "Saindo…") : t("Sign out", "Sair"), onClick: () => void signOut(), disabled: signingOut }}
    accountError={signOutMessage} onboardingSyncing={onboarding.syncing}
    onRetryOnboardingSync={onboarding.syncFailed && !onboarding.syncing ? onboarding.retry : undefined} />;
}

type PrivateArea = {
  token: string;
  workspace: Workspace;
  workspaces: Workspace[];
  onWorkspaceChange: (workspaceId: string) => void;
  onWorkspaceCreated: (workspace: Workspace) => void;
};

function LabExperience({ scope, lab, privateArea, accountAction, accountError, onboardingSyncing, onRetryOnboardingSync }: {
  scope: string;
  lab: LabRoute;
  privateArea?: PrivateArea;
  accountAction: { label: string; onClick: () => void; disabled?: boolean };
  accountError?: string | null;
  onboardingSyncing?: boolean;
  onRetryOnboardingSync?: () => void;
}) {
  const { t } = useLocale();
  const demo = !privateArea;
  const historyKey = `lumora-question-history-v2:${scope}`;
  const [history, setHistory] = useState(() => readQuestionHistory(historyKey));
  const [selectedSource, setSelectedSource] = useState<QuestionSource | null>(null);
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 30_000 });
  const activeTab = lab.tab;
  const workspaceId = privateArea?.workspace.tenantId;
  const workspaceName = privateArea?.workspace.tenantName;
  const conversation = useConversation({ accessToken: privateArea?.token, workspaceId, scope, onAnswered: addAnswer });
  const isChat = activeTab === "answer";
  const showLearningAside = activeTab !== "admin" && !isChat;

  useEffect(() => {
    const clearPreview = () => setSelectedSource(null);
    window.addEventListener("popstate", clearPreview);
    return () => window.removeEventListener("popstate", clearPreview);
  }, []);

  useEffect(() => { saveLocal(historyKey, JSON.stringify(history)); }, [history, historyKey]);

  function addAnswer({ question, response }: { question: string; response: { answer: string; sources: QuestionSource[] } }) {
    setHistory((items) => [{
      id: crypto.randomUUID(), question, answer: response.answer, sources: response.sources,
      createdAt: new Date().toISOString(), feedback: null
    }, ...items].slice(0, 20));
  }

  function setFeedback(id: string, feedback: "up" | "down") {
    setHistory((items) => items.map((item) => item.id === id ? { ...item, feedback } : item));
  }

  return (
    <main className="app-shell text-slate-100">
      <div className="ambient-glow ambient-glow--cyan" aria-hidden="true" />
      <div className="ambient-glow ambient-glow--blue" aria-hidden="true" />
      <div className="relative grid min-h-screen w-full grid-cols-[minmax(0,1fr)] lg:grid-cols-[17rem_minmax(0,1fr)]">
        <LabNavigation activeTab={activeTab} onTabChange={(tab) => navigateTo(pathForTab(tab, lab.workspaceSection, demo))}
          publicDemo={demo} canIndex={demo && canIndexDemo}
          workspaceControl={privateArea ? <WorkspaceSwitcher workspaces={privateArea.workspaces} selectedId={privateArea.workspace.tenantId}
            onChange={privateArea.onWorkspaceChange} compact={isChat}
            creation={{ accessToken: privateArea.token, onWorkspaceCreated: privateArea.onWorkspaceCreated }} /> : undefined} />
        <section className={`min-w-0 ${isChat ? "p-3 sm:p-5 lg:px-8 lg:py-6" : "p-5 sm:p-8 lg:p-10"}`}>
          <LabHeader online={health.data?.status === "ok"} loading={health.isLoading} publicDemo={demo} compact={isChat}
            accountAction={accountAction} />
          {accountError && <p className="error-message mt-5" role="alert">{accountError}</p>}
          {onboardingSyncing && <p className="mt-5 text-sm text-slate-300" role="status">
            {t("Saving your progress with Milo…", "Salvando seu progresso com o Milo…")}
          </p>}
          {onRetryOnboardingSync && <div className="mt-5"><OnboardingSyncNotice onRetry={onRetryOnboardingSync} /></div>}
          <div className={`grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8 ${isChat ? "mt-3 sm:mt-5" : "mt-8"} ${showLearningAside ? "xl:grid-cols-[minmax(0,1fr)_18rem]" : ""}`}>
            <div className="min-w-0">
              {activeTab === "ingest" && <DocumentIngestionForm />}
              {activeTab === "search" && <SemanticSearchForm accessToken={privateArea?.token} workspaceId={workspaceId} workspaceName={workspaceName} />}
              {activeTab === "answer" && <QuestionAnswerForm scope={scope} accessToken={privateArea?.token} workspaceId={workspaceId}
                workspaceName={workspaceName} conversation={conversation} />}
              {activeTab === "history" && <QuestionHistoryPanel history={history} onClear={() => setHistory([])} onFeedback={setFeedback} onInspectSource={setSelectedSource} />}
              {lab.tab === "admin" && privateArea && <Suspense fallback={<p role="status" className="empty-state">{t("Opening workspace…", "Abrindo o espaço…")}</p>}>
                <WorkspaceControlCenter section={lab.workspaceSection} workspace={privateArea.workspace} token={privateArea.token}
                  onSectionChange={(section) => navigateTo(pathForTab("admin", section))} />
              </Suspense>}
              {selectedSource && <SourcePreview source={selectedSource} onClose={() => setSelectedSource(null)} />}
            </div>
            {showLearningAside && <RagLearningAside />}
          </div>
        </section>
      </div>
    </main>
  );
}
