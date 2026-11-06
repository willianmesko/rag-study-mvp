import { createContext, useContext, useEffect, useState, type PropsWithChildren } from "react";

export type Locale = "en" | "pt-BR";
export type LanguagePreference = Locale | "auto";
export type Translate = (english: string, portuguese: string) => string;

const storageKey = "lumora-language";
const LocaleContext = createContext<{
  locale: Locale;
  preference: LanguagePreference;
  setPreference: (preference: LanguagePreference) => void;
  t: Translate;
} | null>(null);

export function detectLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const base = language.toLowerCase().split("-")[0];
    if (base === "pt") return "pt-BR";
    if (base === "en") return "en";
  }
  return "en";
}

function browserLocale(): Locale {
  return detectLocale(navigator.languages.length ? navigator.languages : [navigator.language]);
}

function readPreference(): LanguagePreference {
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (saved === "en" || saved === "pt-BR") return saved;
  } catch {
    // The preference can still be changed for this session.
  }
  return "auto";
}

export function LocaleProvider({ children }: PropsWithChildren) {
  const [preference, updatePreference] = useState(readPreference);
  const [detected, setDetected] = useState(browserLocale);
  const locale = preference === "auto" ? detected : preference;
  const t: Translate = (english, portuguese) => locale === "pt-BR" ? portuguese : english;

  useEffect(() => {
    const onLanguageChange = () => setDetected(browserLocale());
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

  function setPreference(next: LanguagePreference) {
    updatePreference(next);
    try {
      if (next === "auto") window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, next);
    } catch {
      // The current session continues to use the new preference.
    }
  }

  return <LocaleContext.Provider value={{ locale, preference, setPreference, t }}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("LocaleProvider is required.");
  return context;
}
