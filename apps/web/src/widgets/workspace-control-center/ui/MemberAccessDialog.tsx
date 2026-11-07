import { useId, useRef, useState, type FormEvent, type RefObject } from "react";
import type { WorkspaceMember } from "../../../shared/api/rag-api";
import { Overlay } from "../../../shared/ui/Overlay";
import { useLocale } from "../../../shared/i18n/locale";

export type MemberRole = Exclude<WorkspaceMember["role"], "owner">;
export type MemberEdit = { type: "role"; role: MemberRole } | { type: "remove" };

type MemberAccessDialogProps = {
  type: MemberEdit["type"];
  member: WorkspaceMember;
  name: string;
  roleOptions: readonly { value: MemberRole; label: string; description: string }[];
  pending: boolean;
  error: string | null;
  onSave: (action: MemberEdit) => Promise<void>;
  onClose: (saved: boolean) => void;
  fallbackFocusRef: RefObject<HTMLElement | null>;
};

export function MemberAccessDialog({ type, member, name, roleOptions, pending, error, onSave, onClose, fallbackFocusRef }: MemberAccessDialogProps) {
  const { t } = useLocale();
  const [role, setRole] = useState<MemberRole>(member.role === "editor" ? "editor" : "viewer");
  const cancelButton = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const descriptionId = useId();
  const removing = type === "remove";
  const unchangedRole = !removing && role === member.role;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || unchangedRole) return;
    try {
      await onSave(removing ? { type: "remove" } : { type: "role", role });
      onClose(true);
    } catch {
      // The mutation displays the error here so the user can retry or close.
    }
  }

  return (
    <Overlay size="compact" title={removing ? t("Remove access", "Remover acesso") : t("Change role", "Alterar perfil")}
      description={removing
        ? t(`${name} will lose access to this workspace, including its documents and answers. Their Lumora account will stay active.`,
          `${name} perderá o acesso a este espaço, incluindo documentos e respostas. A conta no Lumora continuará ativa.`)
        : t(`Choose what ${name} can do in this workspace.`, `Escolha o que ${name} pode fazer neste espaço.`)}
      pending={pending} initialFocusRef={cancelButton} fallbackFocusRef={fallbackFocusRef} onClose={() => onClose(false)}>
      <form className="space-y-4" onSubmit={(event) => void submit(event)} aria-busy={pending}>
        {!removing && <fieldset className="space-y-2" disabled={pending}>
          <legend className="mb-2 text-xs font-medium text-slate-300">{t("Access role", "Tipo de acesso")}</legend>
          {roleOptions.map(({ value, label, description }) => (
            <label className={`flex items-start gap-3 rounded-xl border border-slate-700 px-3 py-2.5 text-sm transition-colors has-checked:border-cyan-400/70 has-checked:bg-cyan-400/10 ${pending ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-cyan-400/60"}`} key={value}>
              <input type="radio" className="mt-0.5 size-4 shrink-0 accent-cyan-400" name={`${descriptionId}-role`}
                checked={role === value} onChange={() => setRole(value)} aria-labelledby={`${headingId}-${value}`}
                aria-describedby={`${descriptionId}-${value}`} />
              <span>
                <span id={`${headingId}-${value}`} className="block font-medium text-slate-100">{label}</span>
                <span id={`${descriptionId}-${value}`} className="block text-sm text-slate-300">{description}</span>
              </span>
            </label>
          ))}
        </fieldset>}
        {error && <p role="alert" className="error-message">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button ref={cancelButton} className="secondary-button" type="button" disabled={pending} onClick={() => onClose(false)}>
            {t("Cancel", "Cancelar")}
          </button>
          <button className={removing ? "danger-button" : "primary-button"} type="submit" disabled={pending || unchangedRole} aria-busy={pending || undefined}>
            {removing
              ? pending ? t("Removing access…", "Removendo acesso…") : t("Remove access", "Remover acesso")
              : pending ? t("Saving role…", "Salvando perfil…") : t("Save role", "Salvar perfil")}
          </button>
        </div>
      </form>
    </Overlay>
  );
}
