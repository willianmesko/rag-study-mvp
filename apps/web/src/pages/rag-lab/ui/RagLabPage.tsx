import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { QuestionSource } from "../../../shared/api/rag-api";
import { api } from "../../../shared/api/rag-api";
import type { QuestionHistoryEntry } from "../../../entities/question/model/history";
import { DocumentIngestionForm } from "../../../features/document-ingestion/ui/DocumentIngestionForm";
import { QuestionAnswerForm } from "../../../features/question-answering/ui/QuestionAnswerForm";
import { QuestionHistoryPanel } from "../../../features/question-history/ui/QuestionHistoryPanel";
import { SemanticSearchForm } from "../../../features/semantic-search/ui/SemanticSearchForm";
import { SourcePreview } from "../../../shared/ui/SourcePreview";
import { WorkspaceControlCenter } from "../../../widgets/workspace-control-center/ui/WorkspaceControlCenter";
import { LabHeader } from "../../../widgets/lab-layout/ui/LabHeader";
import { LabNavigation, type LabTab } from "../../../widgets/lab-layout/ui/LabNavigation";
import { RagLearningAside } from "../../../widgets/lab-layout/ui/RagLearningAside";
import { supabase } from "../../../shared/lib/supabase";
import { navigateTo, pathForTab, readAppRoute, type WorkspaceSection } from "../../../shared/lib/app-route";
import { useLocale } from "../../../shared/i18n/locale";

const isPublicDemo = import.meta.env.VITE_DEMO_MODE === "true";
const historyStorageKey = "rag-lab-question-history-v1";
const workspaceStorageKey = "rag-lab-workspace-id";

function readSavedWorkspace(): string {
  try { return window.localStorage.getItem(workspaceStorageKey) ?? ""; } catch { return ""; }
}

function saveLocal(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* The current session can continue. */ }
}

function readQuestionHistory(): QuestionHistoryEntry[] {
  try {
    const stored = window.localStorage.getItem(historyStorageKey);
    return stored && Array.isArray(JSON.parse(stored)) ? JSON.parse(stored) as QuestionHistoryEntry[] : [];
  } catch {
    return [];
  }
}

export function RagLabPage() {
  const { t } = useLocale();
  const [route, setRoute] = useState(() => readAppRoute(window.location.pathname, isPublicDemo));
  const [history, setHistory] = useState<QuestionHistoryEntry[]>(readQuestionHistory);
  const [selectedSource, setSelectedSource] = useState<QuestionSource | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState(readSavedWorkspace);
  const [suggestedQuestion, setSuggestedQuestion] = useState("");
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 30_000 });
  const workspaces = useQuery({ queryKey: ["workspaces", accessToken], queryFn: () => api.workspaces(accessToken as string), enabled: Boolean(accessToken) });
  const availableWorkspaces = workspaces.data?.workspaces ?? [];
  const activeWorkspace = availableWorkspaces.find((workspace) => workspace.tenantId === workspaceId) ?? availableWorkspaces[0];
  const activeTab = route.tab;
  const workspaceSection: WorkspaceSection = route.tab === "admin" ? route.workspaceSection : "overview";

  useEffect(() => {
    const onPopState = () => {
      const nextRoute = readAppRoute(window.location.pathname, isPublicDemo);
      setRoute(nextRoute);
      setSelectedSource(null);
      if (nextRoute.tab !== "answer") setSuggestedQuestion("");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    void supabase?.auth.getSession().then(({ data }) => setAccessToken(data.session?.access_token ?? null));
    const listener = supabase?.auth.onAuthStateChange((_event, session) => setAccessToken(session?.access_token ?? null));
    return () => listener?.data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (activeWorkspace && activeWorkspace.tenantId !== workspaceId) {
      setWorkspaceId(activeWorkspace.tenantId);
      saveLocal(workspaceStorageKey, activeWorkspace.tenantId);
    }
  }, [activeWorkspace, workspaceId]);

  useEffect(() => {
    saveLocal(historyStorageKey, JSON.stringify(history));
  }, [history]);

  function addAnswer({ question, response }: { question: string; response: { answer: string; sources: QuestionSource[] } }) {
    setHistory((items) => [{ id: crypto.randomUUID(), question, answer: response.answer, sources: response.sources, createdAt: new Date().toISOString(), feedback: null }, ...items].slice(0, 20));
  }

  function setFeedback(id: string, feedback: "up" | "down") {
    setHistory((items) => items.map((item) => item.id === id ? { ...item, feedback } : item));
  }

  function changeWorkspace(nextId: string) {
    setWorkspaceId(nextId);
    setSelectedSource(null);
    setSuggestedQuestion("");
    saveLocal(workspaceStorageKey, nextId);
  }
  function changeTab(nextTab: LabTab) {
    navigateTo(pathForTab(nextTab, workspaceSection));
  }
  function changeSection(nextSection: WorkspaceSection) {
    navigateTo(pathForTab("admin", nextSection));
  }
  function openSuggestedQuestion(question: string) {
    setSuggestedQuestion(question);
    changeTab("answer");
  }

  const privateScope = activeWorkspace?.tenantId ?? (accessToken ? "signed-in" : "demo");
  return (
    <main className="app-shell text-slate-100">
      <div className="ambient-glow ambient-glow--cyan" />
      <div className="ambient-glow ambient-glow--blue" />
      <div className="relative mx-auto grid min-h-screen max-w-[1500px] lg:grid-cols-[17rem_1fr]">
        <LabNavigation activeTab={activeTab} onTabChange={changeTab} publicDemo={isPublicDemo} />
        <section className="min-w-0 p-5 sm:p-8 lg:p-10">
          <LabHeader online={health.data?.status === "ok"} loading={health.isLoading} publicDemo={isPublicDemo}
            workspaces={availableWorkspaces} workspaceId={activeWorkspace?.tenantId ?? ""} onWorkspaceChange={changeWorkspace} />
          {accessToken && workspaces.isError && <p role="alert" className="error-message mt-5">
            {t("We could not load your workspaces. Sign in again to access private documents.",
               "Não conseguimos carregar seus espaços de trabalho. Entre novamente para acessar documentos privados.")}
          </p>}
          {accessToken && activeTab !== "admin" && workspaces.isSuccess && availableWorkspaces.length === 0 &&
            <p role="status" className="empty-state mt-5">{t("Open Workspace to create your first space.", "Abra Espaço de trabalho para criar seu primeiro espaço.")}</p>}
          <div className={`mt-8 grid gap-8 ${activeTab === "admin" ? "" : "xl:grid-cols-[minmax(0,1fr)_18rem]"}`}>
            <div className="min-w-0">
              {activeTab === "ingest" && <DocumentIngestionForm />}
              {activeTab === "search" && <SemanticSearchForm key={privateScope} accessToken={accessToken} workspaceId={activeWorkspace?.tenantId} workspaceName={activeWorkspace?.tenantName} />}
              {activeTab === "answer" && <QuestionAnswerForm key={privateScope} initialQuestion={suggestedQuestion} accessToken={accessToken}
                workspaceId={activeWorkspace?.tenantId} workspaceName={activeWorkspace?.tenantName} onAnswered={addAnswer} onInspectSource={setSelectedSource} />}
              {activeTab === "history" && <QuestionHistoryPanel history={history} onClear={() => setHistory([])} onFeedback={setFeedback} onInspectSource={setSelectedSource} />}
              {activeTab === "admin" && <WorkspaceControlCenter section={workspaceSection} role={activeWorkspace?.role} selectedWorkspaceId={activeWorkspace?.tenantId}
                onWorkspaceChange={changeWorkspace} onSectionChange={changeSection} onAsk={openSuggestedQuestion} />}
              {selectedSource && <SourcePreview source={selectedSource} onClose={() => setSelectedSource(null)} />}
            </div>
            {activeTab !== "admin" && <RagLearningAside />}
          </div>
        </section>
      </div>
    </main>
  );
}
