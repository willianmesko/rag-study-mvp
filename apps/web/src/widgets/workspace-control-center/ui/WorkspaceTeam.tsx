import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { workspaceRequestError } from "../../../shared/lib/request-error";
import { SelectField } from "../../../shared/ui/SelectField";
import { workspaceRoleLabel } from "../model/labels";
import { membersQuery } from "../model/queries";
import { WorkspaceQueryFeedback } from "./WorkspaceQueryFeedback";

type MemberRole = "editor" | "viewer";
type MemberAction = { type: "role"; userId: string; role: MemberRole } | { type: "remove"; userId: string };

export function WorkspaceTeam({ workspaceId, token }: { workspaceId: string; token: string }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const memberOptions = membersQuery(token, workspaceId);
  const members = useQuery(memberOptions);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("viewer");
  const refreshMembers = () => queryClient.invalidateQueries({ queryKey: memberOptions.queryKey });
  const invite = useMutation({
    mutationFn: (email: string) => api.inviteWorkspaceMember({ workspaceId, email, role: inviteRole, accessToken: token }),
    onSuccess: () => { setInviteEmail(""); return refreshMembers(); }
  });
  const editMember = useMutation({
    mutationFn: (action: MemberAction) => {
      const input = { workspaceId, userId: action.userId, accessToken: token };
      return action.type === "role" ? api.changeWorkspaceMemberRole({ ...input, role: action.role }) : api.removeWorkspaceMember(input);
    },
    onSuccess: refreshMembers
  });
  const removing = editMember.variables?.type === "remove";
  const memberRoleOptions = [
    { value: "viewer", label: workspaceRoleLabel("viewer", t), description: t("Can search and read documents.", "Pode buscar e ler documentos.") },
    { value: "editor", label: workspaceRoleLabel("editor", t), description: t("Can add and manage documents.", "Pode adicionar e gerenciar documentos.") }
  ];

  function submitInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invite.isPending && inviteEmail.trim()) invite.mutate(inviteEmail.trim());
  }

  return (
    <section className="panel space-y-5">
      <div>
        <p className="eyebrow">{t("Team and access", "Equipe e acesso")}</p>
        <h3 className="mt-2 text-lg font-semibold text-white">{t("Workspace members", "Membros do espaço")}</h3>
        <p className="mt-2 text-sm text-slate-400">{t("Owners can invite, change roles, and remove members.", "Proprietários podem convidar, alterar perfis e remover membros.")}</p>
      </div>
      <form className="grid gap-3 sm:grid-cols-2 sm:items-end lg:grid-cols-[minmax(0,1fr)_minmax(9rem,12rem)_auto]" onSubmit={submitInvitation} aria-busy={invite.isPending}>
        <label className="grid min-w-0 gap-2 text-sm text-slate-300">
          {t("Email", "E-mail")}
          <input className="field" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@example.com" readOnly={invite.isPending} required />
        </label>
        <SelectField label={t("Role", "Perfil")} value={inviteRole} options={memberRoleOptions} disabled={invite.isPending}
          onValueChange={(role) => { if (role === "editor" || role === "viewer") setInviteRole(role); }} />
        <button type="submit" className="primary-button sm:col-span-2 sm:justify-self-start lg:col-span-1" disabled={invite.isPending}>{invite.isPending ? t("Sending…", "Enviando…") : t("Invite member", "Convidar")}</button>
      </form>
      {invite.isSuccess && <p className="success-message" role="status">{t("Invitation sent.", "Convite enviado.")}</p>}
      {invite.isError && <p className="error-message" role="alert">{workspaceRequestError(invite.error, t, t("We could not send the invitation. Check the email address.", "Não foi possível enviar o convite. Verifique o endereço de e-mail."))}</p>}
      <WorkspaceQueryFeedback query={members} loading={t("Loading members…", "Carregando membros…")}
        failure={t("We could not load workspace members.", "Não foi possível carregar os membros do espaço.")} />
      {members.isSuccess && members.data.members.length === 0 && <p className="empty-state">{t("No workspace members to display.", "Nenhum membro do espaço para exibir.")}</p>}
      {editMember.isSuccess && <p className="success-message" role="status">{removing
        ? t("Member removed.", "Membro removido.") : t("Member role updated.", "Perfil do membro atualizado.")}</p>}
      {editMember.isError && <p className="error-message" role="alert">{workspaceRequestError(editMember.error, t, removing
        ? t("We could not remove this member.", "Não foi possível remover este membro.")
        : t("We could not change this member’s role.", "Não foi possível alterar o perfil deste membro."))}</p>}
      {members.data && members.data.members.length > 0 && <div className="divide-y divide-slate-800 rounded-xl border border-slate-800">
        {members.data.members.map((member) => {
          const name = member.email ?? t("Email unavailable", "E-mail indisponível");
          const pendingAction = editMember.isPending && editMember.variables.userId === member.userId ? editMember.variables : undefined;
          return (
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm" key={member.userId}>
              <div className="min-w-0 flex-1 basis-48">
                <p className="break-words text-slate-200">{name}</p>
                <p className="mt-1 text-xs text-slate-500">{workspaceRoleLabel(member.role, t)}</p>
              </div>
              {member.role === "owner" ? <span className="text-xs text-cyan-300">{t("Owner role protected", "Perfil de proprietário protegido")}</span> : (
                <div className="flex w-full items-center gap-2 sm:w-auto">
                  <SelectField label={t(`Role for ${name}`, `Perfil de ${name}`)} hideLabel className="min-w-0 flex-1 sm:w-32"
                    value={pendingAction?.type === "role" ? pendingAction.role : member.role} options={memberRoleOptions} disabled={editMember.isPending}
                    onValueChange={(role) => {
                      if ((role === "editor" || role === "viewer") && role !== member.role) editMember.mutate({ type: "role", userId: member.userId, role });
                    }} />
                  <button className="secondary-button min-h-11 shrink-0 text-rose-300 hover:text-rose-100" type="button" disabled={editMember.isPending} onClick={() => {
                    if (window.confirm(t(`Remove ${name}?`, `Remover ${name}?`))) editMember.mutate({ type: "remove", userId: member.userId });
                  }}>{t("Remove", "Remover")}</button>
                </div>
              )}
            </div>
          );
        })}
      </div>}
    </section>
  );
}
