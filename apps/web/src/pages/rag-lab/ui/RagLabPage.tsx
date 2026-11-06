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
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 30_000 });

  useEffect(() => {
    window.localStorage.setItem(historyStorageKey, JSON.stringify(history));
  }, [history]);

  function addAnswer({ question, response }: { question: string; response: { answer: string; sources: QuestionSource[] } }) {
    setHistory((items) => [{ id: crypto.randomUUID(), question, answer: response.answer, sources: response.sources, createdAt: new Date().toISOString(), feedback: null }, ...items].slice(0, 20));
  }

  function setFeedback(id: string, feedback: "up" | "down") {
    setHistory((items) => items.map((item) => item.id === id ? { ...item, feedback } : item));
  }

  return <main className="min-h-screen bg-slate-950 text-slate-100"><div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(34,211,238,0.12),transparent_28rem),radial-gradient(circle_at_90%_15%,rgba(59,130,246,0.1),transparent_24rem)]" /><div className="relative mx-auto grid min-h-screen max-w-7xl lg:grid-cols-[17rem_1fr]"><LabNavigation activeTab={activeTab} onTabChange={setActiveTab} publicDemo={isPublicDemo} /><section className="p-6 sm:p-10"><LabHeader online={health.data?.status === "ok"} loading={health.isLoading} publicDemo={isPublicDemo} /><div className="mt-10 grid gap-8 xl:grid-cols-[minmax(0,1fr)_18rem]"><div className="min-w-0">{activeTab === "ingest" && <DocumentIngestionForm />}{activeTab === "search" && <SemanticSearchForm />}{activeTab === "answer" && <QuestionAnswerForm onAnswered={addAnswer} onInspectSource={setSelectedSource} />}{activeTab === "history" && <QuestionHistoryPanel history={history} onClear={() => setHistory([])} onFeedback={setFeedback} onInspectSource={setSelectedSource} />}{activeTab === "admin" && <AdminPanel />}{selectedSource && <SourcePreview source={selectedSource} onClose={() => setSelectedSource(null)} />}</div><RagLearningAside /></div></section></div></main>;
}
