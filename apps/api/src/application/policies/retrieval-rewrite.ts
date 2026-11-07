/** A bounded lexical rewrite only uses the user's text; documents cannot add retrieval instructions. */
export function rewriteRetrievalQuery(question: string): string {
  const rewritten = question
    .trim()
    .replace(
      /^(?:(?:please|por favor)[,\s]*)?(?:can you (?:tell me|explain)|could you (?:tell me|explain)|what (?:is|are)|tell me (?:about)|explain|o que (?:é|são)|voce pode (?:explicar|dizer)|você pode (?:explicar|dizer)|explique|me (?:explique|diga))\s+/iu,
      "",
    )
    .replace(/[?]+$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  // Negations, dates, entity names, and operators remain intact.
  return (rewritten || question.trim()).slice(0, 1_000);
}
