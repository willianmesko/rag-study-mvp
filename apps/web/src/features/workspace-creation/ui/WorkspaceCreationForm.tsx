import { useId, useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, type Workspace } from "../../../shared/api/rag-api";
import { Overlay } from "../../../shared/ui/Overlay";
import { useLocale } from "../../../shared/i18n/locale";
import { getRequestErrorMessage } from "../../../shared/lib/request-error";

type WorkspaceCreationProps = {
  accessToken: string;
  onWorkspaceCreated: (workspace: Workspace) => void;
  onDismiss?: () => void;
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

export function WorkspaceCreationForm({ accessToken, onWorkspaceCreated, onDismiss }: WorkspaceCreationProps) {
  const { locale, t } = useLocale();
  const [name, setName] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const create = useMutation({
    mutationFn: (workspaceName: string) => api.createWorkspace({
      name: workspaceName,
      slug: workspaceSlug(workspaceName),
      accessToken
    })
  });

  function dismiss() {
    if (create.isPending) return;
    onDismiss?.();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const workspaceName = name.trim();
    if (workspaceName.length < 2 || create.isPending) return;
    create.mutate(workspaceName, { onSuccess: ({ workspace }) => {
      onDismiss?.();
      onWorkspaceCreated(workspace);
    } });
  }

  const form = (
    <form className={onDismiss ? "grid gap-4" : "workspace-guide__stage"} onSubmit={submit} aria-busy={create.isPending}>
      <label className="grid w-full gap-2 text-sm font-medium text-slate-200">
        {t("Workspace name", "Nome do espaço")}
        <input ref={nameInput} className="field" value={name} onChange={(event) => { setName(event.target.value); if (create.isError) create.reset(); }}
          placeholder={t("e.g. Acme team", "Ex.: Equipe Acme")} minLength={2} maxLength={100} required readOnly={create.isPending}
          aria-describedby={create.isError ? errorId : undefined} />
      </label>
      {create.isError && <p id={errorId} className="error-message w-full" role="alert">{getRequestErrorMessage(create.error, locale)}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="primary-button" type="submit" disabled={name.trim().length < 2 || create.isPending} aria-busy={create.isPending || undefined}>
          {create.isPending ? t("Creating workspace…", "Criando espaço…") : t("Create workspace and continue", "Criar espaço e continuar")}
        </button>
        {onDismiss && <button className="secondary-button" type="button" disabled={create.isPending} onClick={dismiss}>
          {t("Cancel", "Cancelar")}
        </button>}
      </div>
    </form>
  );

  if (!onDismiss) return form;
  return (
    <Overlay size="compact" title={t("Create a workspace", "Crie um espaço de trabalho")}
      description={t("Give it a name and we’ll guide you through setup. Each workspace has its own documents and members.",
        "Dê um nome e siga os passos de configuração. Cada espaço tem seus próprios documentos e membros.")}
      pending={create.isPending} initialFocusRef={nameInput} onClose={dismiss}>
      {form}
    </Overlay>
  );
}
