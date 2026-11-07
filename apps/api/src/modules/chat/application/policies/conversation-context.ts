import { redactPii } from "../../../../platform/security/pii-redaction.js";
import { assessPromptInjection } from "../../../../platform/security/prompt-injection.js";

export function preparePreviousQuestions(previousQuestions: readonly string[] = []): string[] {
  const safeQuestions = previousQuestions
    .filter((question) => assessPromptInjection(question).promptInjectionRisk === "low");
  if (safeQuestions.length > 1 && assessPromptInjection(safeQuestions.join("\n")).promptInjectionRisk !== "low") return [];
  return safeQuestions.map((question) => redactPii(question).text);
}

export function createConversationQuery(question: string, previousQuestions: readonly string[] = []): string {
  return previousQuestions.length ? [question, ...Array.from(previousQuestions).reverse()].join("\n") : question;
}
