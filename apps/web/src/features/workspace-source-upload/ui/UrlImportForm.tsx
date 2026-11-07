import { useId, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, ApiError } from "../../../shared/api/rag-api";
import { useLocale, type Translate } from "../../../shared/i18n/locale";

function isHttpsAddress(value: string): boolean {
  if (!/^https:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function urlImportError(code: number | undefined, t: Translate): string {
  switch (code) {
    case 400: return t("Enter a public HTTPS address without sign-in credentials.", "Informe um endereço HTTPS público sem credenciais de acesso.");
    case 401: return t("Sign in again to continue.", "Entre novamente para continuar.");
    case 403: return t("Your role does not allow you to import pages.", "Seu perfil não permite importar páginas.");
    case 413: return t("This page is too large to import. Try a shorter page.", "Esta página é grande demais para importar. Tente uma página menor.");
    case 415: return t("Lumora could not read this page. Try another public page or upload a file.", "O Lumora não conseguiu ler esta página. Tente outra página pública ou envie um arquivo.");
    case 429: return t("Usage limit reached. Try again later.", "Limite de uso atingido. Tente novamente mais tarde.");
    case 502: return t("Lumora could not retrieve this page. Check the address and try again.", "O Lumora não conseguiu buscar esta página. Confira o endereço e tente novamente.");
    case 504: return t("The website took too long to respond. Try again in a moment.", "O site demorou demais para responder. Tente novamente em instantes.");
    default: return t("We could not import this page. Try again in a moment.", "Não foi possível importar esta página. Tente novamente em instantes.");
  }
}

export function UrlImportForm({ accessToken, workspaceId, onImported }: {
  accessToken: string;
  workspaceId: string;
  onImported: () => void;
}) {
  const { t } = useLocale();
  const headingId = useId();
  const hintId = useId();
  const errorId = useId();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [invalidUrl, setInvalidUrl] = useState(false);
  const importPage = useMutation({
    mutationFn: (input: { url: string; title?: string }) => api.importDocumentUrl({ ...input, accessToken, workspaceId }),
    onSuccess: () => {
      setUrl("");
      setTitle("");
      onImported();
    }
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (importPage.isPending) return;
    const address = url.trim();
    const valid = isHttpsAddress(address);
    setInvalidUrl(!valid);
    if (valid) importPage.mutate({ url: address, title: title.trim() || undefined });
    else importPage.reset();
  }

  const errorCode = invalidUrl ? 400 : importPage.error instanceof ApiError ? importPage.error.status : undefined;
  const error = invalidUrl || importPage.isError ? urlImportError(errorCode, t) : null;

  return (
    <form className="panel grid min-w-0 content-start gap-4" onSubmit={submit} aria-labelledby={headingId} aria-busy={importPage.isPending} noValidate>
      <div>
        <p className="eyebrow">{t("Add from the web", "Adicionar da web")}</p>
        <h3 id={headingId} className="mt-2 text-lg font-semibold text-white">{t("Import a web page", "Importar página da web")}</h3>
        <p className="mt-2 text-sm text-slate-400">{t("Lumora saves a copy of the page and prepares its text for search.", "O Lumora salva uma cópia da página e prepara seu texto para a busca.")}</p>
      </div>
      <label className="grid min-w-0 gap-2 text-sm text-slate-300">
        {t("Public HTTPS address", "Endereço HTTPS público")}
        <input className="field" name="url" type="url" value={url} placeholder="https://example.com/guide" maxLength={1000}
          readOnly={importPage.isPending} autoComplete="off" spellCheck={false} required aria-invalid={errorCode === 400}
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          onChange={(event) => { setUrl(event.target.value); setInvalidUrl(false); importPage.reset(); }} />
        <span id={hintId} className="text-xs text-slate-400">{t("Choose a page that anyone can open without signing in.", "Escolha uma página pública que possa ser aberta sem entrar em uma conta.")}</span>
      </label>
      <label className="grid gap-2 text-sm text-slate-300">
        {t("Title (optional)", "Título (opcional)")}
        <input className="field" name="title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={500} readOnly={importPage.isPending} />
      </label>
      <button className="primary-button w-fit" type="submit" disabled={importPage.isPending} aria-busy={importPage.isPending}>
        {importPage.isPending ? t("Importing…", "Importando…") : t("Import page", "Importar página")}
      </button>
      {error && <p id={errorId} className="error-message" role="alert">{error}</p>}
      {importPage.isSuccess && <p className="success-message" role="status">
        {t("Page received. You can follow its progress in Processing.", "Página recebida. Você pode acompanhar o andamento em Processamento.")}
      </p>}
    </form>
  );
}
