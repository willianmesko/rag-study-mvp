import { useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, type WorkspaceMember } from "../../../shared/api/rag-api";
import { useLocale, type Translate } from "../../../shared/i18n/locale";
import { workspaceRequestError } from "../../../shared/lib/request-error";
import { SelectField } from "../../../shared/ui/SelectField";
import { ActionMenu } from "../../../shared/ui/ActionMenu";
import { Overlay } from "../../../shared/ui/Overlay";
import { workspaceRoleLabel } from "../model/labels";
import { membersQuery } from "../model/queries";
import { MemberAccessDialog, type MemberEdit, type MemberRole } from "./MemberAccessDialog";
import { WorkspaceQueryFeedback } from "./WorkspaceQueryFeedback";
import { WorkspacePageHeader } from "./WorkspacePageHeader";

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
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selection, setSelection] = useState<{ type: MemberEdit["type"]; member: WorkspaceMember } | null>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const membersHeading = useRef<HTMLHeadingElement>(null);
  const inviteHintId = useId();
  const inviteErrorId = useId();
  const refreshMembers = () => queryClient.invalidateQueries({ queryKey: memberOptions.queryKey, exact: true });
  const invite = useMutation({
    mutationFn: ({ email, role }: { email: string; role: MemberRole }) =>
      api.inviteWorkspaceMember({ workspaceId, email, role, accessToken: token }),
    onSuccess: () => {
      setInviteEmail("");
      setInviteOpen(false);
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

  function openMemberDialog(type: MemberEdit["type"], member: WorkspaceMember) {
    editMember.reset();
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
      <WorkspacePageHeader title={t("Workspace members", "Pessoas no espaço")} description={countLabel ?? undefined} headingRef={membersHeading}>
        <button className="primary-button" type="button" aria-haspopup="dialog" onClick={() => { invite.reset(); setInviteOpen(true); }}>
          {t("Invite a teammate", "Convidar pessoa")}
        </button>
      </WorkspacePageHeader>
      {inviteOpen && <Overlay title={t("Invite a teammate", "Convidar pessoa")} pending={invite.isPending} initialFocusRef={emailInput}
        description={t("Send an email invitation and choose their access.", "Envie um convite por e-mail e escolha o tipo de acesso.")} onClose={() => setInviteOpen(false)}>
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
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="primary-button" disabled={invite.isPending || !email || existingMember}
              aria-describedby={inviteHintId}>{invite.isPending ? t("Sending invitation…", "Enviando convite…") : t("Send invitation", "Enviar convite")}</button>
            <button type="button" className="secondary-button" disabled={invite.isPending} onClick={() => setInviteOpen(false)}>{t("Cancel", "Cancelar")}</button>
          </div>
        </form>
      </Overlay>}
      {invite.isSuccess && <p className="success-message break-words" role="status">{t(`Invitation sent to ${invite.data.member.email}.`,
        `Convite enviado para ${invite.data.member.email}.`)}</p>}
      <section className="space-y-4" aria-label={t("Members", "Pessoas")}>
        <WorkspaceQueryFeedback query={members} loading={t("Loading workspace members…", "Carregando pessoas do espaço…")}
          failure={t("We couldn’t load the member list.", "Não foi possível carregar a lista de pessoas.")} />
        {count === 0 && <p className="empty-state">{t("No members to show. Send an invitation to share this workspace.",
          "Nenhuma pessoa na lista. Envie um convite para compartilhar este espaço.")}</p>}
        {completedEdit && !selection && <p className="success-message break-words" role="status">{completedEdit.action.type === "remove"
          ? t(`Access removed for ${memberName(completedEdit.member, t)}.`, `Acesso de ${memberName(completedEdit.member, t)} removido.`)
          : t(`Role updated for ${memberName(completedEdit.member, t)}.`, `Perfil de ${memberName(completedEdit.member, t)} atualizado.`)}</p>}
        {members.data && members.data.members.length > 0 && <ul className="divide-y divide-slate-800 border-y border-slate-800">
          {members.data.members.map((member) => {
            const name = memberName(member, t);
            return <li className="flex items-center justify-between gap-3 py-4 text-sm" key={member.userId}>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-100 [overflow-wrap:anywhere]">{name}</p>
                <span className="mt-1 block text-xs text-slate-400" title={roleDetails[member.role]}>{workspaceRoleLabel(member.role, t)}</span>
              </div>
              {member.role === "owner"
                ? <span role="img" className="w-11 text-center text-slate-400" title={t("Owner access is protected", "O acesso de proprietário é protegido")} aria-label={t("Owner access is protected", "O acesso de proprietário é protegido")}>
                  <svg aria-hidden="true" className="mx-auto size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="3" y="7" width="10" height="7" rx="2" /><path d="M5 7V5a3 3 0 0 1 6 0v2" /></svg>
                </span>
                : <ActionMenu label={t(`Actions for ${name}`, `Ações para ${name}`)} actions={[
                  { label: t("Change role", "Alterar perfil"), onSelect: () => openMemberDialog("role", member), disabled: editMember.isPending },
                  { label: t("Remove access", "Remover acesso"), onSelect: () => openMemberDialog("remove", member), destructive: true, disabled: editMember.isPending }
                ]} />}
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
