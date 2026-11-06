import { createContext, useContext, useEffect, useState, type PropsWithChildren } from "react";

export type Locale = "en" | "pt-BR";
export type Translate = (english: string, portuguese: string) => string;

const LocaleContext = createContext<{ locale: Locale; t: Translate } | null>(null);
const portugueseTimeZones = new Set([
  "America/Araguaina", "America/Bahia", "America/Belem", "America/Boa_Vista",
  "America/Campo_Grande", "America/Cuiaba", "America/Eirunepe", "America/Fortaleza",
  "America/Maceio", "America/Manaus", "America/Noronha", "America/Porto_Velho",
  "America/Recife", "America/Rio_Branco", "America/Santarem", "America/Sao_Paulo",
  "Atlantic/Azores", "Atlantic/Madeira", "Europe/Lisbon"
]);

export function detectLocale(languages: readonly string[], timeZone?: string): Locale {
  if (timeZone && portugueseTimeZones.has(timeZone)) return "pt-BR";
  for (const language of languages) {
    const base = language.toLowerCase().split("-")[0];
    if (base === "pt") return "pt-BR";
    if (base === "en") return "en";
  }
  return "en";
}

function browserLocale(): Locale {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return detectLocale(navigator.languages.length ? navigator.languages : [navigator.language], timeZone);
}

export function LocaleProvider({ children }: PropsWithChildren) {
  const [locale, setLocale] = useState(browserLocale);
  const t: Translate = (english, portuguese) => locale === "pt-BR" ? portuguese : english;

  useEffect(() => {
    const onLanguageChange = () => setLocale(browserLocale());
    window.addEventListener("languagechange", onLanguageChange);
    return () => window.removeEventListener("languagechange", onLanguageChange);
  }, []);

  useEffect(() => {
    const portuguese = locale === "pt-BR";
    document.documentElement.lang = locale;
    document.title = portuguese ? "Lumora · Conhecimento da equipe" : "Lumora · Workspace intelligence";
    document.querySelector('meta[name="description"]')?.setAttribute("content", portuguese
      ? "O Lumora transforma o conhecimento da equipe em respostas claras com fontes."
      : "Lumora turns workspace knowledge into clear, grounded answers.");
  }, [locale]);

  return <LocaleContext.Provider value={{ locale, t }}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("LocaleProvider is required.");
  return context;
}
