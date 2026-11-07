import type { PromptInjectionAssessment } from "../../domain/security/prompt-injection.js";

const unknownLegacySecurity: PromptInjectionAssessment = {
  promptInjectionRisk: "high",
  signals: ["missing-ingestion-security-label"]
};

export function readStoredChunkSecurity(metadata: unknown): PromptInjectionAssessment {
  if (!metadata || typeof metadata !== "object") return unknownLegacySecurity;
  const security = (metadata as { security?: unknown }).security;
  if (!security || typeof security !== "object") return unknownLegacySecurity;
  const risk = (security as { promptInjectionRisk?: unknown }).promptInjectionRisk;
  const signals = (security as { signals?: unknown }).signals;
  if (
    (risk === "low" || risk === "medium" || risk === "high") &&
    Array.isArray(signals) &&
    signals.every((signal) => typeof signal === "string")
  ) {
    return { promptInjectionRisk: risk, signals };
  }
  return unknownLegacySecurity;
}
