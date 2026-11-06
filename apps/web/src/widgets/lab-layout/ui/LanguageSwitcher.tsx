import { useLocale } from "../../../shared/i18n/locale";

export function LanguageSwitcher() {
  const { preference, setPreference, t } = useLocale();
  return (
    <label className="workspace-switcher !min-w-0">
      <span className="workspace-switcher__label">{t("Language", "Idioma")}</span>
      <select value={preference} onChange={({ target }) => {
        if (target.value === "en" || target.value === "pt-BR" || target.value === "auto") {
          setPreference(target.value);
        }
      }}>
        <option value="auto">{t("Automatic", "Automático")}</option>
        <option value="en" lang="en">English</option>
        <option value="pt-BR" lang="pt-BR">Português (Brasil)</option>
      </select>
    </label>
  );
}
