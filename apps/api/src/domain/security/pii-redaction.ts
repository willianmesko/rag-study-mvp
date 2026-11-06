export type PiiCategory = "email" | "phone" | "cpf" | "cnpj" | "payment_card";

export type RedactionResult = {
  text: string;
  categories: PiiCategory[];
  count: number;
};

type RedactionRule = { category: PiiCategory; expression: RegExp; replacement: string };

const rules: RedactionRule[] = [
  { category: "email", expression: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: "[REDACTED_EMAIL]" },
  { category: "cpf", expression: /\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b/g, replacement: "[REDACTED_CPF]" },
  { category: "cnpj", expression: /\b\d{2}[.\s]?\d{3}[.\s]?\d{3}[\/\s]?\d{4}[-\s]?\d{2}\b/g, replacement: "[REDACTED_CNPJ]" },
  { category: "payment_card", expression: /\b(?:\d[ -]?){12,18}\d\b/g, replacement: "[REDACTED_PAYMENT_CARD]" },
  { category: "phone", expression: /(?<!\d)(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?9?\d{4}[-\s]?\d{4}(?!\d)/g, replacement: "[REDACTED_PHONE]" }
];

/** Removes common direct identifiers before text leaves this process. */
export function redactPii(text: string): RedactionResult {
  let output = text;
  const categories: PiiCategory[] = [];
  let count = 0;
  for (const rule of rules) {
    let replacements = 0;
    output = output.replace(rule.expression, () => {
      replacements += 1;
      return rule.replacement;
    });
    if (replacements > 0) {
      categories.push(rule.category);
      count += replacements;
    }
  }
  return { text: output, categories, count };
}
