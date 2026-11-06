import { ApiError } from "../api/rag-api";

export function getRequestErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 500) return "O backend respondeu com erro. Verifique a configuração do provedor de IA.";
  return error instanceof Error ? error.message : "Ocorreu um erro inesperado.";
}
