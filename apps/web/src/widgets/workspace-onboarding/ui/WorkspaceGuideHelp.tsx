import { useState } from "react";
import type { WorkspaceOnboardingProgress } from "@rag-study/contracts";
import type { Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { Overlay } from "../../../shared/ui/Overlay";
import type { GuideAnsweredQuestion } from "./GuidePractice";
import { WorkspaceOnboardingWizard } from "./WorkspaceOnboardingWizard";

export function WorkspaceGuideHelp({
  workspace,
  token,
  scope,
  progress,
  onClose,
  onAnswered,
}: {
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
  return (
    <Overlay
      title={t("Milo’s guide", "Guia do Milo")}
      pending={pending}
      onClose={onClose}
      description={t(
        "Review the guide or look up a term. Your completed setup stays saved.",
        "Reveja o guia ou consulte um termo. Sua configuração concluída continua salva.",
      )}
    >
      <WorkspaceOnboardingWizard
        replay
        workspace={workspace}
        accessToken={token}
        scope={scope}
        progress={replay}
        onProgress={(changes) =>
          setReplay((current) => ({ ...current, ...changes }))
        }
        onComplete={onClose}
        onPendingChange={setPending}
        onAnswered={onAnswered}
      />
    </Overlay>
  );
}
