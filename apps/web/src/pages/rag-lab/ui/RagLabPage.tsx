import { Suspense, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WorkspaceOnboardingProgress } from "@rag-study/contracts";
import { createQuestionHistoryEntry, readQuestionHistory } from "../../../entities/question/index";
import { DocumentIngestionForm } from "../../../features/document-ingestion/index";
import { useConversation } from "../../../features/question-answering/index";
import { QuestionAnswerForm } from "../../../features/question-answering/index";
import { ConversationLibrary } from "../../../features/question-answering/index";
import { QuestionHistoryPanel } from "../../../features/question-history/index";
import { SemanticSearchForm } from "../../../features/semantic-search/index";
import { OnboardingSyncNotice } from "../../../features/workspace-onboarding/index";
import { api, type QuestionSource, type Workspace } from "../../../shared/api/rag-api";
import { canIndexDemo } from "../../../shared/config/product-mode";
import { useLocale } from "../../../shared/i18n/locale";
import { conversationPath, navigateTo, pathForTab, type LabRoute } from "../../../shared/lib/app-route";
import { useBrowserLocation } from "../../../shared/lib/browser-location";
import { writeBrowserValue } from "../../../shared/lib/browser-storage";
import { lazyWithRecovery, SectionErrorBoundary } from "../../../shared/ui/SectionErrorBoundary";
import { SourcePreview } from "../../../entities/source/index";
import { LabHeader } from "../../../widgets/lab-layout/index";
import { LabNavigation } from "../../../widgets/lab-layout/index";
import { RagLearningAside } from "../../../widgets/lab-layout/index";
import { WorkspaceSwitcher } from "../../../widgets/lab-layout/index";

const WorkspaceControlCenter = lazyWithRecovery(async () => ({ default: (await import("../../../widgets/workspace-control-center/index")).WorkspaceControlCenter }), "workspace");
const WorkspaceGuideHelp = lazyWithRecovery(async () => ({ default: (await import("../../../widgets/workspace-onboarding/index")).WorkspaceGuideHelp }), "guide");
const WorkspaceSourceDialog = lazyWithRecovery(async () => ({ default: (await import("../../../features/workspace-source-upload/index")).WorkspaceSourceDialog }), "upload");
const WorkspaceMcpConnection = lazyWithRecovery(async () => ({ default: (await import("../../../features/workspace-mcp/index")).WorkspaceMcpConnection }), "connections");

type PrivateArea = {
  token: string;
  guideProgress: WorkspaceOnboardingProgress;
  workspace: Workspace;
  workspaces: Workspace[];
  onWorkspaceChange: (workspaceId: string) => void;
  onWorkspaceCreated: (workspace: Workspace) => void;
};

export function RagLabPage({ scope, lab, privateArea, accountAction, accountError, onboardingSyncing, onRetryOnboardingSync }: {
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
  const [guideOpen, setGuideOpen] = useState(false);
  const [addingDocuments, setAddingDocuments] = useState(false);
  const [suggestion, setSuggestion] = useState<{ id: string; text: string } | null>(null);
  const [selectedSource, setSelectedSource] = useState<QuestionSource | null>(null);
  const health = useQuery({ queryKey: ["health"], queryFn: ({ signal }) => api.health(signal), refetchInterval: 30_000 });
  const location = useBrowserLocation();
  const activeTab = lab.tab;
  const workspaceId = privateArea?.workspace.tenantId;
  const workspaceName = privateArea?.workspace.tenantName;
  const conversation = useConversation({ accessToken: privateArea?.token, workspaceId, scope, onAnswered: addAnswer, observed: activeTab === "answer" || activeTab === "history", messagesObserved: activeTab === "answer" });
  const isChat = activeTab === "answer";
  const showLearningAside = activeTab !== "admin" && activeTab !== "connections" && !isChat;

  useEffect(() => { setSelectedSource(null); }, [location]);

  useEffect(() => { if(!privateArea)writeBrowserValue(historyKey, JSON.stringify(history)); }, [history, historyKey,privateArea]);

  function addAnswer({ question, response }: { question: string; response: { answer: string; sources: QuestionSource[] } }) {
    setHistory((items) => [createQuestionHistoryEntry({ question, response }), ...items].slice(0, 20));
  }

  function setFeedback(id: string, feedback: "up" | "down") {
    setHistory((items) => items.map((item) => item.id === id ? { ...item, feedback } : item));
  }

  return (
    <main className="app-shell text-slate-100">
      <div className="ambient-glow ambient-glow--cyan" aria-hidden="true" />
      <div className="ambient-glow ambient-glow--blue" aria-hidden="true" />
      <div className="relative grid min-h-screen w-full content-start grid-cols-[minmax(0,1fr)] lg:content-stretch lg:grid-cols-[17rem_minmax(0,1fr)]">
        <LabNavigation activeTab={activeTab} onTabChange={(tab) => navigateTo(tab === "answer" && conversation.saved.enabled ? conversationPath(conversation.saved.selectedId) : pathForTab(tab, lab.workspaceSection, demo))}
          publicDemo={demo} canIndex={demo && canIndexDemo} onHelp={privateArea ? () => setGuideOpen(true) : undefined}
          workspaceControl={privateArea ? <WorkspaceSwitcher workspaces={privateArea.workspaces} selectedId={privateArea.workspace.tenantId}
            onChange={privateArea.onWorkspaceChange} compact={isChat} onManageAssistants={() => navigateTo("/connections")}
            creation={{ accessToken: privateArea.token, onWorkspaceCreated: privateArea.onWorkspaceCreated }} /> : undefined} />
        <section className={`min-w-0 ${isChat ? "p-3 sm:p-5 lg:px-8 lg:py-6" : "p-5 sm:p-8 lg:p-10"}`}>
          <LabHeader online={health.data?.status === "ok"} loading={health.isLoading} publicDemo={demo} compact={isChat || activeTab === "admin"}
            accountAction={accountAction} />
          {accountError && <p className="error-message mt-5" role="alert">{accountError}</p>}
          {onboardingSyncing && <p className="mt-5 text-sm text-slate-300" role="status">
            {t("Saving your progress with Milo…", "Salvando seu progresso com o Milo…")}
          </p>}
          {onRetryOnboardingSync && <div className="mt-5"><OnboardingSyncNotice onRetry={onRetryOnboardingSync} /></div>}
          <div className={`grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8 ${isChat ? "mt-3 sm:mt-5" : "mt-8"} ${showLearningAside ? "xl:grid-cols-[minmax(0,1fr)_18rem]" : ""}`}>
            <div className="min-w-0">
              <SectionErrorBoundary key={activeTab} surface={isChat ? "chat" : "workspace"}>
              {activeTab === "ingest" && <DocumentIngestionForm />}
              {activeTab === "search" && <SemanticSearchForm accessToken={privateArea?.token} workspaceId={workspaceId} workspaceName={workspaceName} />}
              {activeTab === "answer" && <QuestionAnswerForm scope={scope} accessToken={privateArea?.token} workspaceId={workspaceId}
                workspaceName={workspaceName} workspaceRole={privateArea?.workspace.role}
                onAddDocuments={privateArea && privateArea.workspace.role !== "viewer" ? () => setAddingDocuments(true) : undefined}
                conversation={conversation} suggestion={suggestion} onSuggestionUsed={() => setSuggestion(null)} />}
              {activeTab === "history" && (conversation.saved.enabled?<ConversationLibrary standalone saved={conversation.saved} onOpen={conversation.saved.open}/>:<QuestionHistoryPanel history={history} onClear={() => setHistory([])} onFeedback={setFeedback} onInspectSource={setSelectedSource} />)}
              {activeTab === "connections" && privateArea && <Suspense fallback={<p role="status">{t("Loading connections…", "Carregando conexões…")}</p>}>
                <WorkspaceMcpConnection token={privateArea.token} workspaceId={privateArea.workspace.tenantId} expanded />
              </Suspense>}
              {lab.tab === "admin" && privateArea && <Suspense fallback={<p role="status" className="empty-state">{t("Opening workspace…", "Abrindo o espaço…")}</p>}>
                <WorkspaceControlCenter section={lab.workspaceSection} workspace={privateArea.workspace} token={privateArea.token}
                  onSectionChange={(section) => navigateTo(pathForTab("admin", section))}
                  onAsk={(question) => { setSuggestion({ id: crypto.randomUUID(), text: question }); navigateTo("/ask"); }} />
              </Suspense>}
              {selectedSource && <SourcePreview source={selectedSource} onClose={() => setSelectedSource(null)} />}
              </SectionErrorBoundary>
            </div>
            {showLearningAside && <RagLearningAside />}
          </div>
        </section>
      </div>
      {guideOpen && privateArea && <Suspense fallback={<p className="sr-only" role="status">{t("Opening Milo’s guide…", "Abrindo o guia do Milo…")}</p>}>
        <WorkspaceGuideHelp workspace={privateArea.workspace} token={privateArea.token} scope={scope} progress={privateArea.guideProgress}
          onClose={() => setGuideOpen(false)} onAnswered={addAnswer} />
      </Suspense>}
      {addingDocuments && privateArea && privateArea.workspace.role !== "viewer" && <Suspense fallback={<p className="sr-only" role="status">{t("Opening document upload…", "Abrindo envio de documentos…")}</p>}>
        <WorkspaceSourceDialog token={privateArea.token} workspaceId={privateArea.workspace.tenantId} onClose={() => setAddingDocuments(false)} />
      </Suspense>}
    </main>
  );
}
