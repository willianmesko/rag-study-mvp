import type { QuestionSource } from "../../../shared/api/rag-api";

export type QuestionHistoryEntry = {
  id: string;
  question: string;
  answer: string;
  sources: QuestionSource[];
  createdAt: string;
  feedback: "up" | "down" | null;
};

type AnsweredQuestion = { question: string; response: { answer: string; sources: QuestionSource[] } };

export function createQuestionHistoryEntry({ question, response }: AnsweredQuestion): QuestionHistoryEntry {
  return {
    id: crypto.randomUUID(), question, answer: response.answer, sources: response.sources,
    createdAt: new Date().toISOString(), feedback: null
  };
}

export function readQuestionHistory(key: string): QuestionHistoryEntry[] {
  try {
    const entries: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(entries) ? entries.slice(0, 20) as QuestionHistoryEntry[] : [];
  } catch { return []; }
}

export function rememberQuestion(scope: string, input: AnsweredQuestion) {
  const key = `lumora-question-history-v2:${scope}`;
  try {
    window.localStorage.setItem(key, JSON.stringify([createQuestionHistoryEntry(input), ...readQuestionHistory(key)].slice(0, 20)));
  } catch { /* Browser history remains optional. */ }
}
