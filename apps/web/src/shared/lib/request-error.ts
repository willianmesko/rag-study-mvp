import { ApiError } from "../api/rag-api";

export function getRequestErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 500) return "The backend returned an error. Check the AI provider configuration.";
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}
