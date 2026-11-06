import type { QuestionSource } from "../../../shared/api/rag-api";

export type QuestionHistoryEntry = {
  id: string;
  question: string;
  answer: string;
  sources: QuestionSource[];
  createdAt: string;
  feedback: "up" | "down" | null;
};
