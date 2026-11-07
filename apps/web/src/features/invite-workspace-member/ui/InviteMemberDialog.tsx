import { useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { membersQuery, workspaceRoleLabel } from "../../../entities/workspace/model/members";
import { ApiError, api } from "../../../shared/api/rag-api";
import { useLocale, type Translate } from "../../../shared/i18n/locale";
import { workspaceRequestError } from "../../../shared/lib/request-error";
import { Overlay } from "../../../shared/ui/Overlay";
import { SelectField } from "../../../shared/ui/SelectField";

function inviteError(error: unknown, t: Translate) {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400: return t("Check the email address and try again.", "Confira o endereço de e-mail e tente novamente.");
      case 409: return t("The invitation could not be sent. Check whether this person already has a Lumora account.",
        "O convite não pôde ser enviado. Verifique se a pessoa já tem uma conta no Lumora.");
      case 503: return t("Email invitations are currently unavailable for this workspace.",
        "Os convites por e-mail estão indisponíveis neste espaço no momento.");
    }
  }
  return workspaceRequestError(error, t, t("We couldn’t send the invitation. Try again in a moment.",
    "Não foi possível enviar o convite. Tente novamente em instantes."));
}

export function InviteMemberDialog({ token, workspaceId, onClose, onInvited }: {
  token: string;
  workspaceId: string;
  onClose: () => void;
  onInvited: (email: string) => void;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const options = membersQuery(token, workspaceId);
  const members = useQuery(options);
  const [value, setValue] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const emailInput = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const errorId = useId();
  const email = value.trim().toLowerCase();
  const existing = members.data?.members.some((member) => member.email?.toLowerCase() === email);
  const invite = useMutation({
    mutationFn: () => api.inviteWorkspaceMember({ workspaceId, email, role, accessToken: token }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: options.queryKey, exact: true });
      onInvited(result.member.email ?? email);
    }
  });
  const details = {
    viewer: t("Can ask questions and read sources.", "Pode fazer perguntas e consultar fontes."),
    editor: t("Can ask questions and manage documents.", "Pode fazer perguntas e gerenciar documentos.")
  };
  const problem = existing
    ? t("This person already has access. Review their role in the member list.", "Esta pessoa já tem acesso. Confira o perfil dela na lista de pessoas.")
    : invite.isError ? inviteError(invite.error, t) : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (email && members.isSuccess && !existing && !invite.isPending) invite.mutate();
  }

  return <Overlay title={t("Invite a teammate", "Convidar pessoa")} pending={invite.isPending} initialFocusRef={emailInput}
    description={t("Send an email invitation and choose their access.", "Envie um convite por e-mail e escolha o tipo de acesso.")} onClose={onClose}>
    <form className="space-y-4" onSubmit={submit} aria-busy={invite.isPending}>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)]">
        <label className="grid min-w-0 gap-1.5 text-xs font-medium text-slate-300">
          {t("Email address", "Endereço de e-mail")}
          <input ref={emailInput} className="field" type="email" inputMode="email" autoComplete="email" spellCheck={false}
            maxLength={320} value={value} onChange={(event) => { setValue(event.target.value); invite.reset(); }}
            placeholder={t("name@example.com", "nome@exemplo.com")} readOnly={invite.isPending} required
            aria-invalid={existing || (invite.error instanceof ApiError && invite.error.status === 400) || undefined}
            aria-describedby={problem ? errorId : undefined} />
        </label>
        <SelectField label={t("Access role", "Tipo de acesso")} value={role} disabled={invite.isPending}
          options={(["viewer", "editor"] as const).map((value) => ({ value, label: workspaceRoleLabel(value, t), description: details[value] }))}
          onValueChange={(next) => { if (next === "editor" || next === "viewer") { setRole(next); invite.reset(); } }} />
      </div>
      <p id={hintId} className="text-sm text-slate-300">{details[role]}</p>
      {members.isPending && <p className="text-sm text-slate-300" role="status">{t("Checking workspace access…", "Conferindo os acessos ao espaço…")}</p>}
      {members.isError && <div className="space-y-2">
        <p className="error-message" role="alert">{t("We couldn’t check the member list. Try again before sending.", "Não conseguimos conferir a lista de pessoas. Tente novamente antes de enviar.")}</p>
        <button type="button" className="secondary-button" onClick={() => void members.refetch()}>{t("Try again", "Tentar novamente")}</button>
      </div>}
      {problem && <p className="error-message" id={errorId} role="alert">{problem}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="primary-button" disabled={invite.isPending || !members.isSuccess || !email || existing}
          aria-describedby={hintId}>{invite.isPending ? t("Sending invitation…", "Enviando convite…") : t("Send invitation", "Enviar convite")}</button>
        <button type="button" className="secondary-button" disabled={invite.isPending} onClick={onClose}>{t("Cancel", "Cancelar")}</button>
      </div>
    </form>
  </Overlay>;
}
