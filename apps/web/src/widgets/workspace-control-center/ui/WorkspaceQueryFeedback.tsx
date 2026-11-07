import { useLocale } from "../../../shared/i18n/locale";
import { workspaceRequestError } from "../../../shared/lib/request-error";

type QueryState = {
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
};

export function WorkspaceQueryFeedback({ query, loading, failure }: { query: QueryState; loading: string; failure: string }) {
  const { t } = useLocale();
  if (query.isLoading) return <p className="text-sm text-slate-400" role="status">{loading}</p>;
  if (!query.isError) return null;
  return <div className="error-message flex flex-wrap items-center justify-between gap-2">
    <p role="alert">{workspaceRequestError(query.error, t, failure)}</p>
    <button type="button" className="secondary-button" disabled={query.isFetching} aria-busy={query.isFetching} onClick={() => void query.refetch()}>
      {query.isFetching ? t("Trying again…", "Tentando novamente…") : t("Try again", "Tentar novamente")}
    </button>
  </div>;
}
