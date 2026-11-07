import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";

export function WorkspaceMcpConnection({ token, workspaceId, expanded = false }: { token: string; workspaceId: string; expanded?: boolean }) {
  const { t, locale } = useLocale();
  const client = useQueryClient();
  const keyId = useId();
  const queryKey = ["workspace-mcp-access", workspaceId, token];
  const status = useQuery({
    queryKey, queryFn: ({ signal }) => api.workspaceMcpAccess(token, workspaceId, signal), retry: false, gcTime: 0
  });
  const connectionsKey = ["workspace-mcp-connections", workspaceId, token];
  const connections = useQuery({ queryKey: connectionsKey, queryFn: ({ signal }) => api.mcpConnections(token, workspaceId, signal), retry: false, gcTime: 0 });
  const [revoking, setRevoking] = useState<string | null>(null);
  const [urlCopied, setUrlCopied] = useState(false);
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
  async function revokeConnection(id: string) {
    if (revoking) return;
    setRevoking(id); setFailure(false);
    try { await api.revokeMcpConnection(token, workspaceId, id); await client.invalidateQueries({ queryKey: connectionsKey }); }
    catch { setFailure(true); }
    finally { setRevoking(null); }
  }

  if (!expanded && !status.isPending && status.data === null && connections.data === null) return null;
  return <details open={expanded || undefined} className="border-b border-slate-800 pb-6">
    <summary className={`min-h-11 rounded-lg py-2 font-semibold text-slate-100 ${expanded ? "text-2xl" : "text-base"}`}>{t("Connected assistants", "Assistentes conectados")}</summary>
    <div className="mt-4 space-y-4">
    {connections.isPending && <p role="status" className="text-sm text-slate-300">{t("Loading connections…", "Carregando conexões…")}</p>}
    {connections.isError && <p role="alert" className="error-message">{t("We could not load your connections.", "Não conseguimos carregar suas conexões.")}
      <button type="button" className="text-action ml-2" onClick={() => void connections.refetch()}>{t("Try again", "Tentar novamente")}</button></p>}
    {connections.data?.url && <section className="space-y-3" aria-label={t("Connect by URL", "Conectar por URL")}>
      <p className="text-sm leading-6 text-slate-300">{t("Add this URL in an assistant that supports remote MCP with OAuth. Sign in to Lumora, choose one workspace and approve the read access you want to share.",
        "Adicione esta URL em um assistente compatível com MCP remoto e OAuth. Entre no Lumora, escolha um espaço e aprove as consultas que deseja compartilhar.")}</p>
      <label htmlFor={`${keyId}-url`} className="block text-xs font-medium text-slate-300">{t("MCP server URL", "URL do servidor MCP")}</label>
      <div className="flex flex-wrap gap-2"><input id={`${keyId}-url`} type="url" className="field min-w-0 flex-1 font-mono text-xs" readOnly value={connections.data.url} />
        <button type="button" className="secondary-button" onClick={() => {
          void navigator.clipboard.writeText(connections.data!.url!).then(() => setUrlCopied(true)).catch(() => setUrlCopied(false));
        }}>{urlCopied ? t("Copied", "Copiada") : t("Copy URL", "Copiar URL")}</button></div>
      <p className="text-xs leading-5 text-slate-400">{t("Only grant access to assistants you trust. Your login stays with Lumora; the assistant receives a separate, revocable connection.",
        "Autorize somente assistentes em que você confia. Seu login fica no Lumora; o assistente recebe uma conexão separada que pode ser revogada.")}</p>
      <h2 className="pt-3 text-base font-semibold">{t("Your connections in this workspace", "Suas conexões neste espaço")}</h2>
      {connections.data.connections.length === 0 ? <p className="text-sm text-slate-400">{t("No assistants connected yet.", "Nenhum assistente conectado ainda.")}</p> :
        <ul className="divide-y divide-slate-800">{connections.data.connections.map((connection) => <li key={connection.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="min-w-0"><p className="break-words font-medium">{connection.clientName}</p>
            <p className="mt-1 text-xs text-slate-400">{t("Expires", "Expira em")} {new Date(connection.expiresAt).toLocaleDateString(locale)} · {connection.allowedTools.length} {t("read tools", "ferramentas de consulta")}</p></div>
          <button type="button" className="secondary-button" disabled={revoking !== null} onClick={() => void revokeConnection(connection.id)}
            aria-label={t(`Revoke ${connection.clientName}`, `Revogar ${connection.clientName}`)}>{revoking === connection.id ? t("Revoking…", "Revogando…") : t("Revoke access", "Revogar acesso")}</button>
        </li>)}</ul>}
    </section>}
    {expanded && connections.data === null && status.data === null && <p className="text-sm text-slate-300">{t("Assistant connections are not enabled on this server.", "As conexões de assistentes não estão habilitadas neste servidor.")}</p>}
    {status.data !== null && <details className="border-t border-slate-800 pt-4"><summary className="min-h-11 py-2 text-sm font-semibold">{t("Local connector · temporary key", "Conector local · chave temporária")}</summary>
    <div>
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
    </details>}
    {(failure || status.isError) && <p role="alert" className="error-message">
      {t("We could not update MCP access. Check your connection and try again.", "Não foi possível atualizar o acesso MCP. Confira sua conexão e tente novamente.")}
    </p>}
    </div>
  </details>;
}
