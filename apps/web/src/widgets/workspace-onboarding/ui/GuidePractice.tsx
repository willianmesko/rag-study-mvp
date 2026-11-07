import { useQueryIdentity } from "../../../shared/lib/query-identity";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getStarterTemplate,
  type StarterGoal,
} from "../../../entities/starter-template/index";
import { rememberQuestion } from "../../../entities/question/index";
import { useConversation } from "../../../features/question-answering/index";
import { QuestionAnswerForm } from "../../../features/question-answering/index";
import { guideDocumentsQuery } from "../../../features/workspace-onboarding/index";
import type { QuestionResponse, Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { InviteMemberDialog } from "../../../features/invite-workspace-member/index";

export type GuideAnsweredQuestion = {
  question: string;
  response: QuestionResponse;
};

export function GuidePractice({
  workspace,
  token,
  scope,
  goal,
  onPendingChange,
  onReadyChange,
  onConversationReady,
  onAnswered,
}: {
  workspace: Workspace;
  token: string;
  scope: string;
  goal: StarterGoal;
  onPendingChange: (pending: boolean) => void;
  onReadyChange: (ready: boolean) => void;
  onConversationReady: (id: string) => void;
  onAnswered?: (input: GuideAnsweredQuestion) => void;
}) {
  const userId = useQueryIdentity();
  const { locale, t } = useLocale();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invited, setInvited] = useState(false);
  const documents = useQuery({
    ...guideDocumentsQuery(token, workspace.tenantId, userId),
    refetchInterval: (query) =>
      !query.state.error && query.state.data?.documents.length === 0
        ? 3_000
        : false,
  });
  const conversation = useConversation({
    accessToken: token,
    workspaceId: workspace.tenantId,
    scope: `${scope}:guide`,
    navigation: false,
    onAnswered: (input) =>
      onAnswered ? onAnswered(input) : rememberQuestion(scope, input),
  });
  const busy =
    conversation.submitting ||
    conversation.live.phase !== null ||
    conversation.comparison.isPending ||
    conversation.turns.some(({ status }) => status === "pending");
  useEffect(() => {
    onPendingChange(busy);
    return () => onPendingChange(false);
  }, [busy, onPendingChange]);
  const answered = conversation.turns.some(
    ({ answer, status }) =>
      status === "completed" &&
      answer &&
      !answer.refusalReason &&
      answer.sources.length > 0,
  );
  useEffect(() => {
    onReadyChange(answered);
  }, [answered, onReadyChange]);
  useEffect(() => {
    if (answered && conversation.saved.selectedId)
      onConversationReady(conversation.saved.selectedId);
  }, [answered, conversation.saved.selectedId, onConversationReady]);
  const template = getStarterTemplate(goal, locale);
  const hasSample = documents.data?.documents.some(
    ({ source }) => source === `onboarding/templates/${template.filename}`,
  );
  const suggestions = [
    hasSample
      ? template.questions[0]
      : t("Summarize the main points", "Resuma os pontos principais"),
  ];

  return (
    <div className="workspace-guide__detail">
      {documents.isPending && (
        <p role="status">
          {t(
            "Checking whether your documents are ready…",
            "Conferindo se os documentos estão prontos…",
          )}
        </p>
      )}
      {documents.isError && (
        <div className="space-y-2">
          <p className="error-message" role="alert">
            {t(
              "We couldn’t load the documents. Refresh to try your question.",
              "Não conseguimos carregar os documentos. Atualize para experimentar sua pergunta.",
            )}
          </p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void documents.refetch()}
          >
            {t("Refresh documents", "Atualizar documentos")}
          </button>
        </div>
      )}
      {documents.data && documents.data.documents.length === 0 && (
        <p className="workspace-guide__example" role="status">
          {t(
            "Your first question needs a prepared document. Go back to add one, wait for processing, or finish setup and reopen this guide from Help later.",
            "Sua primeira pergunta precisa de um documento pronto. Volte para adicionar um, aguarde o processamento ou conclua a configuração e reabra este guia em Ajuda depois.",
          )}
        </p>
      )}
      {Boolean(documents.data?.documents.length) && (
        <>
          <QuestionAnswerForm
            embedded
            scope={`${scope}:guide`}
            accessToken={token}
            workspaceId={workspace.tenantId}
            workspaceRole={workspace.role}
            workspaceName={workspace.tenantName}
            conversation={conversation}
            suggestions={suggestions}
          />
        </>
      )}
      {answered && (
        <p role="status">
          {t(
            "Open a source below the answer to check its supporting passage.",
            "Abra uma fonte abaixo da resposta para conferir o trecho que a sustenta.",
          )}
        </p>
      )}
      {answered && workspace.role === "owner" && (
        <div className="w-full border-t border-slate-700 pt-3">
          {invited ? (
            <p role="status">
              {t(
                "Invitation sent. Your team can explore these documents too.",
                "Convite enviado. Sua equipe também pode explorar estes documentos.",
              )}
            </p>
          ) : (
            <button
              type="button"
              className="text-action min-h-11"
              aria-haspopup="dialog"
              onClick={() => setInviteOpen(true)}
            >
              {t("Invite a teammate", "Convidar pessoa")}
            </button>
          )}
        </div>
      )}
      {inviteOpen && workspace.role === "owner" && (
        <InviteMemberDialog
          token={token}
          workspaceId={workspace.tenantId}
          onClose={() => setInviteOpen(false)}
          onInvited={() => {
            setInviteOpen(false);
            setInvited(true);
          }}
        />
      )}
    </div>
  );
}
