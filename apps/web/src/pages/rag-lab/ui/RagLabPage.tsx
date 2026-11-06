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
import { AdminPanel } from "../../../widgets/admin-corpus/ui/AdminPanel";
import { LabHeader } from "../../../widgets/lab-layout/ui/LabHeader";
import { LabNavigation, type LabTab } from "../../../widgets/lab-layout/ui/LabNavigation";
import { RagLearningAside } from "../../../widgets/lab-layout/ui/RagLearningAside";
import { supabase } from "../../../shared/lib/supabase";

const isPublicDemo = import.meta.env.VITE_DEMO_MODE === "true";
const historyStorageKey = "rag-lab-question-history-v1";

function readQuestionHistory(): QuestionHistoryEntry[] {
  try {
    const stored = window.localStorage.getItem(historyStorageKey);
    return stored && Array.isArray(JSON.parse(stored)) ? JSON.parse(stored) as QuestionHistoryEntry[] : [];
  } catch {
    return [];
  }
}

export function RagLabPage() {
  const [activeTab, setActiveTab] = useState<LabTab>(isPublicDemo ? "search" : "ingest");
  const [history, setHistory] = useState<QuestionHistoryEntry[]>(readQuestionHistory);
  const [selectedSource, setSelectedSource] = useState<QuestionSource | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState(() => window.localStorage.getItem("rag-lab-workspace-id") ?? "");
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 30_000 });
  const workspaces = useQuery({ queryKey: ["public-workspaces", accessToken], queryFn: () => api.workspaces(accessToken as string), enabled: Boolean(accessToken) });
  const availableWorkspaces = workspaces.data?.workspaces ?? [];
  const activeWorkspace = availableWorkspaces.find((workspace) => workspace.tenantId === workspaceId) ?? availableWorkspaces[0];

  useEffect(() => {
    void supabase?.auth.getSession().then(({ data }) => setAccessToken(data.session?.access_token ?? null));
    const listener = supabase?.auth.onAuthStateChange((_event, session) => setAccessToken(session?.access_token ?? null));
    return () => listener?.data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (activeWorkspace && activeWorkspace.tenantId !== workspaceId) {
      setWorkspaceId(activeWorkspace.tenantId);
      window.localStorage.setItem("rag-lab-workspace-id", activeWorkspace.tenantId);
    }
  }, [activeWorkspace, workspaceId]);

  useEffect(() => {
    window.localStorage.setItem(historyStorageKey, JSON.stringify(history));
  }, [history]);

  function addAnswer({ question, response }: { question: string; response: { answer: string; sources: QuestionSource[] } }) {
    setHistory((items) => [{ id: crypto.randomUUID(), question, answer: response.answer, sources: response.sources, createdAt: new Date().toISOString(), feedback: null }, ...items].slice(0, 20));
  }

  function setFeedback(id: string, feedback: "up" | "down") {
    setHistory((items) => items.map((item) => item.id === id ? { ...item, feedback } : item));
  }

  const changeWorkspace = (nextId: string) => { setWorkspaceId(nextId); window.localStorage.setItem("rag-lab-workspace-id", nextId); };
  return <main className="app-shell text-slate-100"><div className="ambient-glow ambient-glow--cyan" /><div className="ambient-glow ambient-glow--blue" /><div className="relative mx-auto grid min-h-screen max-w-[1500px] lg:grid-cols-[17rem_1fr]"><LabNavigation activeTab={activeTab} onTabChange={setActiveTab} publicDemo={isPublicDemo} /><section className="min-w-0 p-5 sm:p-8 lg:p-10"><LabHeader online={health.data?.status === "ok"} loading={health.isLoading} publicDemo={isPublicDemo} workspaces={availableWorkspaces} workspaceId={activeWorkspace?.tenantId ?? ""} onWorkspaceChange={changeWorkspace} />{accessToken && workspaces.isError && <p role="alert" className="error-message mt-5">Unable to load your workspaces. Please sign in again before searching a private corpus.</p>}{accessToken && !workspaces.isLoading && !workspaces.isError && availableWorkspaces.length === 0 && <p role="status" className="empty-state mt-5">No workspace is available yet. Open the Workspace tab to create your first workspace.</p>}<div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_18rem]"><div className="min-w-0">{activeTab === "ingest" && <DocumentIngestionForm />}{activeTab === "search" && <SemanticSearchForm accessToken={accessToken} workspaceId={activeWorkspace?.tenantId} workspaceName={activeWorkspace?.tenantName} />}{activeTab === "answer" && <QuestionAnswerForm accessToken={accessToken} workspaceId={activeWorkspace?.tenantId} workspaceName={activeWorkspace?.tenantName} onAnswered={addAnswer} onInspectSource={setSelectedSource} />}{activeTab === "history" && <QuestionHistoryPanel history={history} onClear={() => setHistory([])} onFeedback={setFeedback} onInspectSource={setSelectedSource} />}{activeTab === "admin" && <AdminPanel selectedWorkspaceId={activeWorkspace?.tenantId} onWorkspaceChange={changeWorkspace} />}{selectedSource && <SourcePreview source={selectedSource} onClose={() => setSelectedSource(null)} />}</div><RagLearningAside /></div></section></div></main>;
}
