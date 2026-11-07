import { useState } from "react";
import type { WorkspaceOnboardingProgress } from "@rag-study/contracts";
import type { Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { Overlay } from "../../../shared/ui/Overlay";
import type { GuideAnsweredQuestion } from "./GuidePractice";
import { WorkspaceOnboardingWizard } from "./WorkspaceOnboardingWizard";

export function WorkspaceGuideHelp({ workspace, token, scope, progress, onClose, onAnswered }: {
  workspace: Workspace;
  token: string;
  scope: string;
  progress: WorkspaceOnboardingProgress;
  onClose: () => void;
  onAnswered: (input: GuideAnsweredQuestion) => void;
}) {
  const { t } = useLocale();
  const [replay, setReplay] = useState(progress);
  const [pending, setPending] = useState(false);
  return <Overlay title={t("Milo’s guide", "Guia do Milo")} pending={pending} onClose={onClose}
    description={t("Revisit the guide without changing your completed setup. Uploads, questions, and invitations here are real workspace actions.",
      "Reveja o guia sem alterar a configuração concluída. Envios, perguntas e convites aqui são ações reais do espaço.")}>
    <WorkspaceOnboardingWizard replay workspace={workspace} accessToken={token} scope={scope} progress={replay}
      onProgress={(changes) => setReplay((current) => ({ ...current, ...changes }))} onComplete={onClose}
      onPendingChange={setPending} onAnswered={onAnswered} />
  </Overlay>;
}
