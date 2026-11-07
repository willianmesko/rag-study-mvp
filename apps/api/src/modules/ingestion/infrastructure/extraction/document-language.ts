type DocumentLanguage = "en" | "pt" | "mixed" | "und";

const englishSignals = new Set([
  "the", "and", "of", "to", "in", "for", "with", "is", "that", "from", "are", "was", "were", "will", "should",
  "this", "those", "has", "have", "your", "our", "after", "before", "each", "when", "which", "review", "workspace", "policy"
]);
const portugueseSignals = new Set([
  "da", "do", "das", "dos", "com", "uma", "umas", "na", "nas", "no", "nos", "ao", "aos", "pelo", "pela", "serao",
  "sao", "foi", "foram", "tambem", "nao", "voce", "equipe", "revisao", "politica", "prazo", "atendimento", "arquivo",
  "documentos", "podem", "devem", "quando", "informacoes", "solicitacao", "portugues"
]);

export function readLanguageHint(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[a-z]{2,8}(?:-[a-z0-9]{1,8}){0,5}$/.test(normalized) ? normalized : undefined;
}

export function detectDocumentLanguage(text: string, hint?: string): DocumentLanguage {
  const tokens = text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").match(/\p{L}+/gu) ?? [];
  const words = new Set(tokens);
  let en = 0;
  let pt = 0;
  for (const word of words) {
    if (englishSignals.has(word)) en++;
    if (portugueseSignals.has(word)) pt++;
  }

  if (Math.min(en, pt) >= 3 && Math.min(en, pt) / Math.max(en, pt) >= 0.35) return "mixed";
  if (en >= 2 && en > pt) return "en";
  if (pt >= 2 && pt > en) return "pt";

  const primaryHint = hint?.split("-")[0];
  const latinWords = tokens.filter((word) => /^[a-z]+$/.test(word)).length;
  if (latinWords >= 4 && latinWords >= tokens.length * 0.8) {
    if (primaryHint === "en" && pt === 0) return "en";
    if (primaryHint === "pt" && en === 0) return "pt";
  }
  return "und";
}
