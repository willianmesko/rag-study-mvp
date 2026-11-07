import { useLocale } from "../../../shared/i18n/locale";

export function OnboardingSyncNotice({ onRetry }: { onRetry: () => void }) {
  const { t } = useLocale();
  return <div className="error-message flex flex-wrap items-center justify-between gap-3">
    <p role="alert">{t("Milo’s progress couldn’t sync. You can keep going on this device and try again when you’re online.",
      "O progresso do Milo não foi sincronizado. Você pode continuar neste dispositivo e tentar de novo quando estiver online.")}</p>
    <button type="button" className="secondary-button" onClick={onRetry}>{t("Retry sync", "Tentar sincronizar")}</button>
  </div>;
}
