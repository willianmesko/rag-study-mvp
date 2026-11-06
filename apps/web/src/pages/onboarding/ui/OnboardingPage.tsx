import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, type Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { getRequestErrorMessage } from "../../../shared/lib/request-error";
import { BrandMark } from "../../../shared/ui/BrandMark";
import { Mascot } from "../../../shared/ui/Mascot";
import { WorkspaceSwitcher } from "../../../widgets/lab-layout/ui/WorkspaceSwitcher";
import { WorkspaceOnboardingWizard } from "../../../widgets/workspace-onboarding/ui/WorkspaceOnboardingWizard";

type OnboardingPageProps = {
  workspace?: Workspace;
  workspaces: Workspace[];
  accessToken: string;
  userId: string;
  onWorkspaceCreated: (workspace: Workspace) => void;
  onWorkspaceChange: (workspaceId: string) => void;
  onComplete: () => void;
  onSignOut: () => void;
};

function workspaceSlug(name: string): string {
  const prefix = name.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return `${prefix || "workspace"}-${crypto.randomUUID().slice(0, 8)}`;
}

function CreateWorkspaceStep({ accessToken, onWorkspaceCreated }: Pick<OnboardingPageProps, "accessToken" | "onWorkspaceCreated">) {
  const { locale, t } = useLocale();
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: (workspaceName: string) => api.createWorkspace({
      name: workspaceName,
      slug: workspaceSlug(workspaceName),
      accessToken
    })
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const workspaceName = name.trim();
    if (workspaceName.length >= 2 && !create.isPending) {
      create.mutate(workspaceName, { onSuccess: ({ workspace }) => onWorkspaceCreated(workspace) });
    }
  }

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
      <form className="workspace-guide__stage" onSubmit={submit} aria-busy={create.isPending}>
        <label className="grid w-full gap-2 text-sm font-medium text-slate-200">
          {t("Workspace name", "Nome do espaço")}
          <input className="field" value={name} onChange={(event) => setName(event.target.value)}
            placeholder={t("e.g. Acme Legal", "Ex.: Jurídico da Acme")} minLength={2} maxLength={100} required disabled={create.isPending} />
        </label>
        {create.error && <p className="error-message w-full" role="alert">{getRequestErrorMessage(create.error, locale)}</p>}
        <button className="primary-button" type="submit" disabled={name.trim().length < 2 || create.isPending}>
          {create.isPending ? t("Creating workspace…", "Criando espaço…") : t("Create workspace and continue", "Criar espaço e continuar")}
        </button>
      </form>
    </section>
  );
}

export function OnboardingPage({ workspace, workspaces, accessToken, userId, onWorkspaceCreated, onWorkspaceChange, onComplete, onSignOut }: OnboardingPageProps) {
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
        {workspace
          ? <WorkspaceOnboardingWizard workspace={workspace} userId={userId} accessToken={accessToken} onComplete={onComplete} />
          : <CreateWorkspaceStep key={userId} accessToken={accessToken} onWorkspaceCreated={onWorkspaceCreated} />}
        <p className="text-center text-xs text-slate-400">
          {t("Your progress is saved in this browser.", "Seu progresso fica salvo neste navegador.")}
        </p>
      </div>
    </main>
  );
}
