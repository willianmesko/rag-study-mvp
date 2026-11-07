import { ApiError } from "../api/rag-api";
import type { Locale, Translate } from "../i18n/locale";

export function getRequestErrorMessage(error: unknown, locale: Locale = "en"): string {
  const t: Translate = (en, pt) => locale === "pt-BR" ? pt : en;
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400: return t("Check the details and try again.", "Confira os dados informados e tente novamente.");
      case 401: return t("Sign in again to continue.", "Entre novamente para continuar.");
      case 403: return t("Your workspace access does not allow this action.", "Seu acesso ao espaço não permite esta ação.");
      case 404: return t("This item is no longer available.", "Este item não está mais disponível.");
      case 409: return t("Something changed since you opened this page. Refresh and try again.", "Algo mudou desde que você abriu esta página. Atualize e tente novamente.");
      case 429: return t("You’ve reached a usage limit. Try again later.", "Você atingiu um limite de uso. Tente novamente mais tarde.");
    }
  }
  if (error instanceof TypeError) return t("Lumora couldn’t connect. Check your connection and try again.", "O Lumora não conseguiu conectar. Confira sua conexão e tente novamente.");
  return t("Lumora couldn’t complete this action. Try again in a moment.", "O Lumora não conseguiu concluir esta ação. Tente novamente em instantes.");
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
