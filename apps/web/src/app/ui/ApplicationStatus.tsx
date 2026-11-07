import { useLocale } from "../../shared/i18n/locale";
import { Mascot } from "../../shared/ui/Mascot";

export function ApplicationStatus({ message, onRetry, onSignOut }: { message: string; onRetry?: () => void; onSignOut?: () => void }) {
  const { t } = useLocale();
  return (
    <main className="app-shell grid min-h-svh place-items-center p-5">
      <section className={`panel w-full max-w-md${onRetry ? "" : " text-center"}`}>
        {!onRetry && <div className="mx-auto mb-5 grid size-28 place-items-center rounded-full bg-cyan-400/5 ring-1 ring-cyan-300/15" aria-hidden="true">
          <Mascot size="sm" className="workspace-loading-milo" decorative />
        </div>}
        <p className="eyebrow">Lumora</p>
        <p className="mt-2 text-slate-200" role={onRetry ? "alert" : "status"}>{message}</p>
        {onRetry && <div className="mt-5 flex flex-wrap gap-3">
          <button className="primary-button" type="button" onClick={onRetry}>{t("Try again", "Tentar novamente")}</button>
          {onSignOut && <button className="secondary-button" type="button" onClick={onSignOut}>{t("Sign out", "Sair")}</button>}
        </div>}
      </section>
    </main>
  );
}
