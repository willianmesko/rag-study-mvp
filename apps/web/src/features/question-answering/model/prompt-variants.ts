import type { ChatAnswerUsage, ChatPromptVariantId } from "@rag-study/contracts";
import type { Translate } from "../../../shared/i18n/locale";

export function promptVariantLabel(id: ChatPromptVariantId, t: Translate): string {
  return { balanced: t("Balanced", "Equilibrado"), concise: t("Concise", "Conciso"), explanatory: t("Explanatory", "Explicativo") }[id];
}

export function answerSafetyLabel(outcome: ChatAnswerUsage["safetyOutcome"] | undefined, t: Translate): string {
  if (!outcome) return t("Not recorded", "Não registrado");
  return {
    validated: t("Format and source IDs checked", "Formato e fontes conferidos"),
    refused: t("Answer declined by validation", "Resposta recusada pela validação"),
    unstructured: t("Structured format not verified", "Formato estruturado não verificado"),
    cached: t("Previously saved answer", "Resposta salva anteriormente"),
    provider_failed: t("Provider failed", "Falha do provedor")
  }[outcome];
}
