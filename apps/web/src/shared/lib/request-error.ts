import { ApiError } from "../api/rag-api";
import type { Locale } from "../i18n/locale";

export function getRequestErrorMessage(error: unknown, locale: Locale = "en"): string {
  if (error instanceof ApiError && error.status === 500 && locale === "en") {
    return "The server could not complete the request. Try again in a moment.";
  }
  if (locale === "pt-BR") {
    if (error instanceof ApiError) {
      switch (error.status) {
        case 400: return "Confira os dados informados e tente novamente.";
        case 401: return "Entre na sua conta para continuar.";
        case 403: return "Você não tem acesso para realizar esta ação.";
        case 404: return "Não encontramos o recurso solicitado.";
        case 409: return "Esta ação entra em conflito com os dados atuais. Atualize a página e tente novamente.";
        case 429: return "O limite de solicitações foi atingido. Tente novamente mais tarde.";
      }
    }
    if (error instanceof TypeError) return "Não foi possível conectar ao Lumora. Confira sua conexão e tente novamente.";
    return "Não foi possível concluir a solicitação. Tente novamente em instantes.";
  }
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}
