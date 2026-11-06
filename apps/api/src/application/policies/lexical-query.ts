const stopWords = new Set([
  "a", "o", "as", "os", "um", "uma", "uns", "umas", "de", "da", "das", "do", "dos", "e", "é", "em", "no", "na", "nos", "nas",
  "para", "por", "com", "sem", "sobre", "que", "qual", "quais", "como", "onde", "quando", "porque", "porquê", "se", "ao", "aos",
  "the", "a", "an", "is", "are", "what", "which", "how", "where", "when", "why", "of", "to", "in", "on", "for", "with"
]);

/**
 * Embeddings receive the user's original question. The lexical retriever gets
 * only meaningful terms so a question's stopwords do not turn FTS AND matching
 * into an accidental zero-result query.
 */
export function toLexicalQuery(question: string): string {
  const tokens = question.toLocaleLowerCase("pt-BR").match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return tokens.filter((token) => token.length > 1 && !stopWords.has(token)).join(" ");
}
