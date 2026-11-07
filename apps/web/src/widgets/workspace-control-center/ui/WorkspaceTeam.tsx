import { useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, type WorkspaceMember } from "../../../shared/api/rag-api";
import { useLocale, type Translate } from "../../../shared/i18n/locale";
import { workspaceRequestError } from "../../../shared/lib/request-error";
import { SelectField } from "../../../shared/ui/SelectField";
import { workspaceRoleLabel } from "../model/labels";
import { membersQuery } from "../model/queries";
import { MemberAccessDialog, type MemberEdit, type MemberRole } from "./MemberAccessDialog";
import { WorkspaceQueryFeedback } from "./WorkspaceQueryFeedback";

function memberName(member: WorkspaceMember, t: Translate) {
  return member.email ?? t("Email unavailable", "E-mail indisponível");
}

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

export function WorkspaceTeam({ workspaceId, token }: { workspaceId: string; token: string }) {
  const { locale, t } = useLocale();
  const queryClient = useQueryClient();
  const memberOptions = membersQuery(token, workspaceId);
  const members = useQuery(memberOptions);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("viewer");
  const [selection, setSelection] = useState<{ type: MemberEdit["type"]; member: WorkspaceMember } | null>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const membersHeading = useRef<HTMLHeadingElement>(null);
  const inviteHeadingId = useId();
  const inviteHintId = useId();
  const inviteErrorId = useId();
  const membersHeadingId = useId();
  const refreshMembers = () => queryClient.invalidateQueries({ queryKey: memberOptions.queryKey, exact: true });
  const invite = useMutation({
    mutationFn: ({ email, role }: { email: string; role: MemberRole }) =>
      api.inviteWorkspaceMember({ workspaceId, email, role, accessToken: token }),
    onSuccess: () => {
      setInviteEmail("");
      emailInput.current?.focus();
      void refreshMembers();
    }
  });
  const editMember = useMutation({
    mutationFn: ({ action, member }: { action: MemberEdit; member: WorkspaceMember }) => {
      const input = { workspaceId, userId: member.userId, accessToken: token };
      return action.type === "role" ? api.changeWorkspaceMemberRole({ ...input, role: action.role }) : api.removeWorkspaceMember(input);
    },
    onSuccess: (_, { action, member }) => {
      queryClient.setQueryData<{ members: WorkspaceMember[] }>(memberOptions.queryKey, (current) => current && ({
        members: action.type === "remove"
          ? current.members.filter(({ userId }) => userId !== member.userId)
          : current.members.map((item) => item.userId === member.userId ? { ...item, role: action.role } : item)
      }));
      void refreshMembers();
    },
    onError: (error) => {
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) void refreshMembers();
    }
  });

  const roleDetails = {
    owner: t("Manages people, documents, and workspace settings.", "Gerencia pessoas, documentos e configurações do espaço."),
    editor: t("Can ask questions and manage documents.", "Pode fazer perguntas e gerenciar documentos."),
    viewer: t("Can ask questions and read sources.", "Pode fazer perguntas e consultar fontes.")
  };
  const roleOptions = (["viewer", "editor"] as const).map((value) => ({
    value,
    label: workspaceRoleLabel(value, t),
    description: roleDetails[value]
  }));
  const email = inviteEmail.trim().toLowerCase();
  const existingMember = members.data?.members.some((member) => member.email?.toLowerCase() === email);
  const invitationProblem = existingMember
    ? t("This person already has access. Review their role in the member list.", "Esta pessoa já tem acesso. Confira o perfil dela na lista de pessoas.")
    : invite.isError ? inviteError(invite.error, t) : null;
  const count = members.data?.members.length;
  const formattedCount = count === undefined ? null : new Intl.NumberFormat(locale).format(count);
  const countLabel = count === undefined ? null : count === 1
    ? t("1 member", "1 pessoa")
    : t(`${formattedCount} members`, `${formattedCount} pessoas`);

  function submitInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (email && !invite.isPending && !existingMember) invite.mutate({ email, role: inviteRole });
  }

  function openMemberDialog(type: MemberEdit["type"], member: WorkspaceMember, trigger: HTMLButtonElement) {
    editMember.reset();
    trigger.focus();
    setSelection({ type, member });
  }

  function closeMemberDialog(saved: boolean) {
    if (saved && selection?.type === "remove") membersHeading.current?.focus();
    setSelection(null);
  }

  const completedEdit = editMember.isSuccess ? editMember.variables : undefined;
  const editError = editMember.isError && selection
    ? editMember.error instanceof ApiError && (editMember.error.status === 404 || editMember.error.status === 409)
      ? t("This person’s access has changed. Close this window and review the member list.",
        "O acesso desta pessoa mudou. Feche esta janela e confira a lista de pessoas.")
      : workspaceRequestError(editMember.error, t, selection.type === "remove"
        ? t("We couldn’t remove access. Try again in a moment.", "Não foi possível remover o acesso. Tente novamente em instantes.")
        : t("We couldn’t save the role. Try again in a moment.", "Não foi possível salvar o perfil. Tente novamente em instantes."))
    : null;

  return (
    <div className="space-y-6">
      <section className="panel space-y-5" aria-labelledby={inviteHeadingId}>
        <div>
          <h3 id={inviteHeadingId} className="text-lg font-semibold text-white">{t("Invite a teammate", "Convidar para o espaço")}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-300">{t("Send an email invitation and choose what the person can do in this workspace.",
            "Envie um convite por e-mail e escolha o que a pessoa pode fazer neste espaço.")}</p>
        </div>
        <form className="space-y-4" onSubmit={submitInvitation} aria-busy={invite.isPending}>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)]">
            <label className="grid min-w-0 gap-1.5 text-xs font-medium text-slate-300">
              {t("Email address", "Endereço de e-mail")}
              <input ref={emailInput} className="field" type="email" inputMode="email" autoComplete="email" spellCheck={false}
                maxLength={320} value={inviteEmail} onChange={(event) => { setInviteEmail(event.target.value); invite.reset(); }}
                placeholder={t("name@example.com", "nome@exemplo.com")} readOnly={invite.isPending} required
                aria-invalid={existingMember || (invite.error instanceof ApiError && invite.error.status === 400) || undefined}
                aria-describedby={invitationProblem ? inviteErrorId : undefined} />
            </label>
            <SelectField label={t("Access role", "Tipo de acesso")} value={inviteRole} options={roleOptions} disabled={invite.isPending}
              onValueChange={(role) => { if (role === "editor" || role === "viewer") { setInviteRole(role); invite.reset(); } }} />
          </div>
          <p id={inviteHintId} className="text-sm text-slate-300">{roleDetails[inviteRole]}</p>
          {invitationProblem && <p className="error-message" id={inviteErrorId} role="alert">{invitationProblem}</p>}
          <button type="submit" className="primary-button w-full sm:w-auto" disabled={invite.isPending || !email || existingMember}
            aria-describedby={inviteHintId}>{invite.isPending ? t("Sending invitation…", "Enviando convite…") : t("Send invitation", "Enviar convite")}</button>
        </form>
        {invite.isSuccess && <p className="success-message break-words" role="status">{t(`Invitation sent to ${invite.data.member.email}.`,
          `Convite enviado para ${invite.data.member.email}.`)}</p>}
      </section>

      <section className="panel space-y-5" aria-labelledby={membersHeadingId}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 ref={membersHeading} id={membersHeadingId} className="text-lg font-semibold text-white" tabIndex={-1}>
              {t("Workspace members", "Pessoas no espaço")}
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">{t("Review who has access to this workspace and what they can do.",
              "Confira quem tem acesso a este espaço e o que cada pessoa pode fazer.")}</p>
          </div>
          {countLabel && <span className="status-pill">{countLabel}</span>}
        </div>
        <WorkspaceQueryFeedback query={members} loading={t("Loading workspace members…", "Carregando pessoas do espaço…")}
          failure={t("We couldn’t load the member list.", "Não foi possível carregar a lista de pessoas.")} />
        {count === 0 && <p className="empty-state">{t("No members to show. Send an invitation to share this workspace.",
          "Nenhuma pessoa na lista. Envie um convite para compartilhar este espaço.")}</p>}
        {completedEdit && !selection && <p className="success-message break-words" role="status">{completedEdit.action.type === "remove"
          ? t(`Access removed for ${memberName(completedEdit.member, t)}.`, `Acesso de ${memberName(completedEdit.member, t)} removido.`)
          : t(`Role updated for ${memberName(completedEdit.member, t)}.`, `Perfil de ${memberName(completedEdit.member, t)} atualizado.`)}</p>}
        {members.data && members.data.members.length > 0 && <ul className="divide-y divide-slate-800 rounded-xl border border-slate-700">
          {members.data.members.map((member) => {
            const name = memberName(member, t);
            return <li className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm" key={member.userId}>
              <div className="min-w-0 flex-1 basis-52">
                <p className="font-medium text-slate-100 [overflow-wrap:anywhere]">{name}</p>
                <span className="status-pill mt-2">{workspaceRoleLabel(member.role, t)}</span>
                <p className="mt-2 text-sm text-slate-300">{roleDetails[member.role]}</p>
              </div>
              {member.role === "owner"
                ? <span className="text-sm text-slate-300">{t("Owner access is protected", "O acesso de proprietário é protegido")}</span>
                : <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                  <button type="button" className="secondary-button flex-1 whitespace-nowrap" aria-haspopup="dialog"
                    aria-label={t(`Change role for ${name}`, `Alterar perfil de ${name}`)}
                    onClick={(event) => openMemberDialog("role", member, event.currentTarget)}>
                    {t("Change role", "Alterar perfil")}
                  </button>
                  <button type="button" className="secondary-button flex-1 whitespace-nowrap text-rose-200" aria-haspopup="dialog"
                    aria-label={t(`Remove access for ${name}`, `Remover acesso de ${name}`)}
                    onClick={(event) => openMemberDialog("remove", member, event.currentTarget)}>
                    {t("Remove access", "Remover acesso")}
                  </button>
                </div>}
            </li>;
          })}
        </ul>}
      </section>
      {selection && <MemberAccessDialog type={selection.type} member={selection.member} name={memberName(selection.member, t)}
        roleOptions={roleOptions} pending={editMember.isPending} error={editError}
        onSave={(action) => editMember.mutateAsync({ action, member: selection.member })} onClose={closeMemberDialog} />}
    </div>
  );
}
