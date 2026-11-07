import { useQueryIdentity } from "../../../shared/lib/query-identity";
import { privateQueryKey } from "../../../shared/lib/query-keys";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { knowledgeStatusQuery } from "../../../entities/workspace/index";
import { useLocale } from "../../../shared/i18n/locale";
import { Overlay } from "../../../shared/ui/Overlay";
import { UrlImportForm } from "./UrlImportForm";
import { WorkspaceFileUpload } from "./WorkspaceFileUpload";

/** Shared by the document library and chat; uploads keep their server RBAC. */
export function WorkspaceSourceDialog({ token, workspaceId, onClose, onAdded }: {
  token: string; workspaceId: string; onClose: () => void; onAdded?: () => void;
}) {
  const userId = useQueryIdentity();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [sourceType, setSourceType] = useState<"file" | "url">("file");
  const [pending, setPending] = useState(false);

  function added() {
    void queryClient.invalidateQueries({ queryKey: privateQueryKey("documents", userId, workspaceId) });
    void queryClient.invalidateQueries({ queryKey: privateQueryKey("ingestion-jobs", userId, workspaceId) });
    void queryClient.invalidateQueries({ queryKey: knowledgeStatusQuery(token, workspaceId, userId).queryKey });
    onAdded?.();
    onClose();
  }

  return <Overlay title={t("Add documents", "Adicionar documentos")} pending={pending} onClose={onClose}>
    <p className="text-sm leading-6 text-slate-300">{t(
      "Choose a file or a public web page. Your documents stay in the selected workspace; Milo can use them once processing finishes.",
      "Escolha um arquivo ou uma página pública. Os documentos ficam no espaço selecionado; o Milo poderá consultá-los após o processamento."
    )}</p>
    <div className="flex gap-2" role="group" aria-label={t("Source type", "Tipo de material")}>
      <button type="button" className={sourceType === "file" ? "primary-button" : "secondary-button"} aria-pressed={sourceType === "file"} disabled={pending} onClick={() => setSourceType("file")}>{t("File", "Arquivo")}</button>
      <button type="button" className={sourceType === "url" ? "primary-button" : "secondary-button"} aria-pressed={sourceType === "url"} disabled={pending} onClick={() => setSourceType("url")}>{t("Web page", "Página da web")}</button>
    </div>
    {sourceType === "file"
      ? <WorkspaceFileUpload token={token} workspaceId={workspaceId} onUploaded={added} onPendingChange={setPending} />
      : <UrlImportForm accessToken={token} workspaceId={workspaceId} onImported={added} onPendingChange={setPending} />}
  </Overlay>;
}
