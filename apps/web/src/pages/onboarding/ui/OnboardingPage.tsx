import type { WorkspaceOnboardingProgress } from "@rag-study/contracts";
import { WorkspaceCreationForm } from "../../../features/workspace-creation/ui/WorkspaceCreationForm";
import { OnboardingSyncNotice } from "../../../features/workspace-onboarding/ui/OnboardingSyncNotice";
import type { Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { BrandMark } from "../../../shared/ui/BrandMark";
import { Mascot } from "../../../shared/ui/Mascot";
import { WorkspaceSwitcher } from "../../../widgets/lab-layout/ui/WorkspaceSwitcher";
import { WorkspaceOnboardingWizard } from "../../../widgets/workspace-onboarding/ui/WorkspaceOnboardingWizard";

type OnboardingPageProps = {
  workspace?: Workspace;
  workspaces: Workspace[];
  accessToken: string;
  userId: string;
  justCreated?: boolean;
  progress: WorkspaceOnboardingProgress;
  syncing: boolean;
  syncFailed: boolean;
  onWorkspaceCreated: (workspace: Workspace) => void;
  onWorkspaceChange: (workspaceId: string) => void;
  onProgress: (changes: Partial<WorkspaceOnboardingProgress>) => void;
  onRetrySync: () => void;
  onComplete: () => void;
  onSignOut: () => void;
};

function CreateWorkspaceStep({ accessToken, onWorkspaceCreated }: Pick<OnboardingPageProps, "accessToken" | "onWorkspaceCreated">) {
  const { t } = useLocale();

  return (
    <section className="workspace-guide" aria-labelledby="create-workspace-heading">
      <header className="workspace-guide__hero">
        <div>
          <p className="eyebrow">{t("Get started", "Primeiros passos")}</p>
          <h1 id="create-workspace-heading">{t("Make a space for your team", "Crie um espaço para sua equipe")}</h1>
          <p className="workspace-guide__introduction">
            {t(
              "Hi, I’m Milo. Give your workspace a name and I’ll show you how to find answers in your team’s documents.",
              "Oi, eu sou o Milo. Dê um nome ao seu espaço e eu mostro como encontrar respostas nos documentos da equipe."
            )}
          </p>
        </div>
        <div className="workspace-guide__mascot" aria-hidden="true"><Mascot decorative /></div>
      </header>
      <WorkspaceCreationForm accessToken={accessToken} onWorkspaceCreated={onWorkspaceCreated} />
    </section>
  );
}

export function OnboardingPage({ workspace, workspaces, accessToken, userId, justCreated, progress, syncing, syncFailed, onWorkspaceCreated, onWorkspaceChange, onProgress, onRetrySync, onComplete, onSignOut }: OnboardingPageProps) {
  const { t } = useLocale();

  return (
    <main className="app-shell min-h-dvh">
      <div className="ambient-glow ambient-glow--cyan" aria-hidden="true" />
      <div className="ambient-glow ambient-glow--blue" aria-hidden="true" />
      <div className="relative mx-auto grid max-w-4xl gap-6 px-4 py-5 sm:gap-10 sm:px-8 sm:py-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
          <div className="flex min-h-11 items-center gap-3 font-semibold text-white"><BrandMark compact /> Lumora</div>
          <div className="flex min-w-0 flex-wrap items-end gap-3">
            {workspace && workspaces.length > 1 && <WorkspaceSwitcher workspaces={workspaces} selectedId={workspace.tenantId} onChange={onWorkspaceChange} />}
            <button type="button" className="secondary-button min-h-11" onClick={onSignOut}>{t("Sign out", "Sair")}</button>
          </div>
        </header>
        {workspace && justCreated && <p className="success-message" role="status">
          {t(`Workspace created. Let’s set up ${workspace.tenantName}.`, `Espaço criado. Vamos configurar ${workspace.tenantName}.`)}
        </p>}
        {workspace
          ? <WorkspaceOnboardingWizard key={workspace.tenantId} workspace={workspace} accessToken={accessToken}
            scope={`${userId}:${workspace.tenantId}`} progress={progress} onProgress={onProgress} onComplete={onComplete} />
          : <CreateWorkspaceStep key={userId} accessToken={accessToken} onWorkspaceCreated={onWorkspaceCreated} />}
        {workspace && (syncFailed && !syncing
          ? <OnboardingSyncNotice onRetry={onRetrySync} />
          : <p className="text-center text-xs text-slate-400" role="status">{syncing
            ? t("Saving your progress…", "Salvando seu progresso…")
            : t("Continue on any device using this account.", "Continue em qualquer dispositivo com esta conta.")}</p>)}
      </div>
    </main>
  );
}
