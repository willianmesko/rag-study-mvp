import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { mcpReadToolNames, type McpReadToolName } from "@rag-study/contracts";
import { api, type Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { navigateTo } from "../../../shared/lib/app-route";
import { Mascot } from "../../../shared/ui/Mascot";

export function McpConsentPage({ requestId, token, workspaces }: { requestId: string | null; token: string; workspaces: Workspace[] }) {
  const { t } = useLocale();
  const fieldId = useId();
  const details = useQuery({ queryKey: ["mcp-consent", requestId, token],
    queryFn: ({ signal }) => api.mcpConsent(token, requestId!, signal), enabled: Boolean(requestId), retry: false, gcTime: 0 });
  const [selected, setSelected] = useState("");
  const [tools, setTools] = useState<McpReadToolName[]>(mcpReadToolNames.filter((name) => name !== "get_quality_report"));
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expired, setExpired] = useState(false);
  const workspace = workspaces.find((item) => item.tenantId === selected);
  const allowedTools = tools.filter((name) => name !== "get_quality_report" || workspace?.role === "owner");
  const descriptions: Record<McpReadToolName, string> = {
    list_sources: t("List your documents", "Listar seus documentos"),
    get_document: t("Read screened document excerpts", "Ler trechos verificados dos documentos"),
    search_workspace: t("Search by meaning and keywords", "Buscar por significado e palavras-chave"),
    get_ingestion_status: t("Check document processing", "Consultar o processamento dos documentos"),
    get_quality_report: t("Read saved quality reports (owner only)", "Ler relatórios de qualidade salvos (somente proprietário)")
  };
  useEffect(() => {
    if (!details.data) return;
    const delay = new Date(details.data.expiresAt).getTime() - Date.now();
    if (delay <= 0) { setExpired(true); return; }
    const timer = setTimeout(() => setExpired(true), delay);
    return () => clearTimeout(timer);
  }, [details.data]);

  async function decide(approve: boolean) {
    if (!requestId || pending || expired || (approve && (!workspace || !allowedTools.length))) return;
    setPending(true); setFailed(false);
    try {
      const result = approve ? await api.approveMcpConsent(token, workspace!.tenantId, requestId, allowedTools)
        : await api.denyMcpConsent(token, requestId);
      // The destination comes only from the registered, server-validated redirect.
      // The caller cannot supply a redirect through the consent page URL.
      window.location.assign(result.redirectUrl);
    } catch { setFailed(true); setPending(false); }
  }

  return <main className="app-shell grid min-h-svh place-items-center p-4 sm:p-8">
    <section className="panel w-full max-w-xl" aria-labelledby="mcp-consent-heading">
      <div className="flex items-center gap-4"><Mascot size="sm" decorative /><div>
        <p className="eyebrow">Lumora</p>
        <h1 id="mcp-consent-heading" className="mt-1 text-2xl font-semibold">{t("Connect your assistant", "Conecte seu assistente")}</h1>
      </div></div>
      {(!requestId || expired || details.isError) ? <div className="mt-6 space-y-4">
        <p role="alert" className="error-message">{t("This connection request is invalid, expired or already completed. Start again in your assistant.",
          "Esta solicitação é inválida, expirou ou já foi concluída. Comece novamente pelo seu assistente.")}</p>
        <button type="button" className="secondary-button" onClick={() => navigateTo("/connections")}>{t("View my connections", "Ver minhas conexões")}</button>
      </div> : details.isPending ? <p role="status" className="mt-6 text-slate-300">{t("Checking the connection request…", "Verificando a solicitação de conexão…")}</p>
        : <form className="mt-6 space-y-6" onSubmit={(event) => { event.preventDefault(); void decide(true); }}>
          <div className="space-y-2 text-sm leading-6 text-slate-300">
            <p><strong className="break-words text-slate-100">{details.data.clientName}</strong> {t("wants to read one of your workspaces.", "quer consultar um dos seus espaços de trabalho.")}</p>
            <p>{t("App names are not verified. Continue only if you started this connection and trust the destination:", "Os nomes dos aplicativos não são verificados. Continue somente se você iniciou esta conexão e confia no destino:")}</p>
            <p className="break-all rounded-lg bg-slate-900 p-3 font-mono text-xs text-cyan-100">{details.data.redirectOrigin}</p>
          </div>
          <div><label htmlFor={fieldId} className="mb-2 block text-sm font-medium">{t("Choose a workspace", "Escolha um espaço de trabalho")}</label>
            <select id={fieldId} className="field" required value={selected} disabled={pending} onChange={(event) => setSelected(event.target.value)}>
              <option value="">{t("Select one workspace…", "Selecione um espaço…")}</option>
              {workspaces.map((item) => <option key={item.tenantId} value={item.tenantId}>{item.tenantName}</option>)}
            </select>
            {!workspaces.length && <p className="mt-2 text-sm text-slate-300">{t("Create or join a workspace in Lumora, then restart this connection.", "Crie um espaço ou entre em um pelo Lumora e reinicie esta conexão.")}</p>}
          </div>
          <fieldset disabled={pending || !workspace} className="space-y-2">
            <legend className="mb-2 text-sm font-semibold">{t("Allow this assistant to", "Permitir que este assistente")}</legend>
            {details.data.tools.filter((name) => name !== "get_quality_report" || workspace?.role === "owner").map((name) =>
              <label key={name} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm hover:bg-slate-800/60">
                <input type="checkbox" className="size-4 accent-cyan-300" checked={tools.includes(name)} onChange={(event) => setTools((current) =>
                  event.target.checked ? [...current, name] : current.filter((tool) => tool !== name))} />{descriptions[name]}
              </label>)}
          </fieldset>
          <p className="text-xs leading-5 text-slate-400">{t("This connection cannot edit documents, invite people or run evaluations. Searches may use your workspace’s AI budget. Access expires within 30 days; you can revoke it at any time under Connected assistants.",
            "Esta conexão não pode editar documentos, convidar pessoas ou executar avaliações. As buscas podem usar o orçamento de IA do espaço. O acesso expira em até 30 dias e pode ser revogado a qualquer momento em Assistentes conectados.")}</p>
          {failed && <p role="alert" className="error-message">{t("We could not complete this request. Check your permissions and try again.", "Não conseguimos concluir a solicitação. Verifique suas permissões e tente novamente.")}</p>}
          <div className="flex flex-wrap gap-3">
            <button type="submit" className="primary-button" disabled={pending || !workspace || !allowedTools.length}>{pending ? t("Connecting…", "Conectando…") : t("Allow connection", "Permitir conexão")}</button>
            <button type="button" className="secondary-button" disabled={pending} onClick={() => void decide(false)}>{t("Decline", "Recusar")}</button>
          </div>
        </form>}
    </section>
  </main>;
}
