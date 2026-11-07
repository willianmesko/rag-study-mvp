import { ApiError } from "../api/rag-api";
import type { Locale, Translate } from "../i18n/locale";

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

export function workspaceRequestError(error: unknown, t: Translate, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  switch (error.status) {
    case 401: return t("Sign in again to continue.", "Entre novamente para continuar.");
    case 403: return t("Your role does not allow this action.", "Seu perfil não permite esta ação.");
    case 404: return t("We could not find this item.", "Não encontramos este item.");
    case 413: return t("This file is too large to upload.", "Este arquivo é grande demais para envio.");
    case 429: return t("Usage limit reached. Try again later.", "Limite de uso atingido. Tente novamente mais tarde.");
    default: return fallback;
  }
}
