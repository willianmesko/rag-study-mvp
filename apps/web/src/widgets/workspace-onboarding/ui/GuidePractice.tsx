import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getStarterTemplate, type StarterGoal } from "../../../entities/starter-template/model/starter-templates";
import { rememberQuestion } from "../../../entities/question/model/history";
import { useConversation } from "../../../features/question-answering/model/use-conversation";
import { QuestionAnswerForm } from "../../../features/question-answering/ui/QuestionAnswerForm";
import { guideDocumentsQuery } from "../../../features/workspace-onboarding/model/knowledge-queries";
import type { QuestionResponse, Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { GuideConcepts } from "./GuideConcepts";

export type GuideAnsweredQuestion = { question: string; response: QuestionResponse };

export function GuidePractice({ workspace, token, scope, goal, onPendingChange, onAnswered }: {
  workspace: Workspace;
  token: string;
  scope: string;
  goal: StarterGoal;
  onPendingChange: (pending: boolean) => void;
  onAnswered?: (input: GuideAnsweredQuestion) => void;
}) {
  const { locale, t } = useLocale();
  const documents = useQuery({
    ...guideDocumentsQuery(token, workspace.tenantId),
    refetchInterval: (query) => !query.state.error && query.state.data?.documents.length === 0 ? 3_000 : false
  });
  const conversation = useConversation({
    accessToken: token, workspaceId: workspace.tenantId, scope: `${scope}:guide`,
    navigation:false,
    onAnswered: (input) => onAnswered ? onAnswered(input) : rememberQuestion(scope, input)
  });
  const busy = conversation.submitting || conversation.live.phase !== null || conversation.comparison.isPending || conversation.turns.some(({ status }) => status === "pending");
  useEffect(() => {
    onPendingChange(busy);
    return () => onPendingChange(false);
  }, [busy, onPendingChange]);
  const template = getStarterTemplate(goal, locale);
  const hasSample = documents.data?.documents.some(({ source }) => source === `onboarding/templates/${template.filename}`);
  const suggestions = hasSample ? template.questions : [
    t("Summarize the main points", "Resuma os pontos principais"),
    t("What steps does this document recommend?", "Quais etapas este documento recomenda?")
  ];

  return <div className="workspace-guide__detail">
    {documents.isPending && <p role="status">{t("Checking whether your documents are ready…", "Conferindo se os documentos estão prontos…")}</p>}
    {documents.isError && <div className="space-y-2">
      <p className="error-message" role="alert">{t("We couldn’t load the documents. Refresh to try your question.", "Não conseguimos carregar os documentos. Atualize para experimentar sua pergunta.")}</p>
      <button className="secondary-button" type="button" onClick={() => void documents.refetch()}>{t("Refresh documents", "Atualizar documentos")}</button>
    </div>}
    {documents.data && documents.data.documents.length === 0 && <p className="workspace-guide__example" role="status">
      {t("Your first question needs a prepared document. Go back to add one, wait for processing, or finish setup and reopen this guide from Help later.",
        "Sua primeira pergunta precisa de um documento pronto. Volte para adicionar um, aguarde o processamento ou conclua a configuração e reabra este guia em Ajuda depois.")}
    </p>}
    {Boolean(documents.data?.documents.length) && <>
      <p>{t("Choose a suggested question or ask your own. This is a real workspace answer and counts toward your question limit. Open ‘Read sources and passages’ below the reply to check its evidence.",
        "Escolha uma sugestão ou faça sua pergunta. Esta é uma resposta real do espaço e conta no limite de perguntas. Abra ‘Ler fontes e trechos’ abaixo da resposta para conferir as evidências.")}</p>
      <QuestionAnswerForm embedded scope={`${scope}:guide`} accessToken={token} workspaceId={workspace.tenantId}
        workspaceRole={workspace.role}
        workspaceName={workspace.tenantName} conversation={conversation} suggestions={suggestions} />
    </>}
    <GuideConcepts />
  </div>;
}
