import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";

export function WorkspaceMcpConnection({ token, workspaceId }: { token: string; workspaceId: string }) {
  const { t, locale } = useLocale();
  const client = useQueryClient();
  const keyId = useId();
  const queryKey = ["workspace-mcp-access", workspaceId, token];
  const status = useQuery({
    queryKey, queryFn: ({ signal }) => api.workspaceMcpAccess(token, workspaceId, signal), retry: false, gcTime: 0
  });
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState(false);
  const [copied, setCopied] = useState(false);

  async function updateAccess(create: boolean) {
    if (pending) return;
    setPending(true);
    setFailure(false);
    setCopied(false);
    setVisible(false);
    setIssuedKey(null);
    try {
      if (create) {
        const credential = await api.issueWorkspaceMcpAccess(token, workspaceId);
        setIssuedKey(credential.token);
        client.setQueryData(queryKey, { expiresAt: credential.expiresAt });
      } else {
        await api.revokeWorkspaceMcpAccess(token, workspaceId);
        client.setQueryData(queryKey, { expiresAt: null });
      }
    } catch {
      setFailure(true);
    } finally {
      setPending(false);
    }
  }

  async function copyKey() {
    if (!issuedKey) return;
    try { await navigator.clipboard.writeText(issuedKey); setCopied(true); }
    catch { setVisible(true); }
  }

  if (!status.isPending && status.data === null) return null;
  return <section className="panel space-y-4">
    <div>
      <p className="eyebrow">MCP</p>
      <h3 className="mt-2 text-lg font-semibold text-white">{t("Connect your assistant", "Conecte seu assistente")}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-300">
        {t("Let an MCP-compatible assistant search this workspace, read screened passages, and inspect saved quality reports.",
          "Permita que um assistente compatível com MCP busque neste espaço, leia trechos verificados e consulte relatórios de qualidade salvos.")}
      </p>
      <p className="mt-2 text-xs leading-5 text-slate-400">
        {t("Each key lasts 15 minutes and allows up to 40 read calls, with 10 calls per minute. Creating a key replaces your previous key for this workspace.",
          "Cada chave dura 15 minutos e permite até 40 consultas, com 10 por minuto. Criar uma chave substitui sua chave anterior deste espaço.")}
      </p>
    </div>
    {status.data?.expiresAt && <p className="text-sm text-cyan-200">
      {t("Current key expires at", "A chave atual expira às")} {new Date(status.data.expiresAt).toLocaleTimeString(locale)}
    </p>}
    <div className="flex flex-wrap gap-2">
      <button className="primary-button" type="button" disabled={pending || status.isPending || status.isError} onClick={() => void updateAccess(true)}>
        {pending ? t("Updating access…", "Atualizando acesso…") : t("Create temporary key", "Criar chave temporária")}
      </button>
      {status.data?.expiresAt && <button className="secondary-button" type="button" disabled={pending} onClick={() => void updateAccess(false)}>
        {t("Revoke key", "Revogar chave")}
      </button>}
    </div>
    {issuedKey && <div className="grid gap-3 rounded-xl border border-cyan-400/25 bg-slate-950/70 p-4">
      <label htmlFor={keyId} className="text-xs text-slate-300">{t("Temporary MCP key", "Chave temporária do MCP")}</label>
      <input id={keyId} type={visible ? "text" : "password"} className="field font-mono" readOnly value={issuedKey} autoComplete="off" spellCheck={false} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="secondary-button" onClick={() => void copyKey()}>
          {copied ? t("Copied", "Copiada") : t("Copy key", "Copiar chave")}
        </button>
        <button type="button" className="secondary-button" onClick={() => setVisible((current) => !current)}>
          {visible ? t("Hide key", "Ocultar chave") : t("Show key", "Mostrar chave")}
        </button>
        <button type="button" className="text-action" onClick={() => setIssuedKey(null)}>{t("Dismiss", "Fechar")}</button>
      </div>
      <p className="text-xs leading-5 text-slate-300">
        {t("Use this as LUMORA_MCP_TOKEN in your local connector. It is shown only in this session. Keep it private.",
          "Use esta chave em LUMORA_MCP_TOKEN no conector local. Ela só aparece nesta sessão. Mantenha-a privada.")}
      </p>
    </div>}
    <p className="break-all text-xs text-slate-400">LUMORA_MCP_WORKSPACE_ID={workspaceId}</p>
    {(failure || status.isError) && <p role="alert" className="error-message">
      {t("We could not update MCP access. Check your connection and try again.", "Não foi possível atualizar o acesso MCP. Confira sua conexão e tente novamente.")}
    </p>}
  </section>;
}
