export type PromptInjectionRisk = "low" | "medium" | "high";

export type PromptInjectionAssessment = {
  promptInjectionRisk: PromptInjectionRisk;
  signals: string[];
};

type DetectionRule = {
  id: string;
  risk: "medium" | "high";
  expression: RegExp;
};

const rules: DetectionRule[] = [
  {
    id: "instruction-override",
    risk: "high",
    expression: /\b(ignore|disregard|forget|bypass|desconsidere|ignore|ignore\s+todas?)\b[\s\S]{0,80}\b(previous|prior|above|system|developer|anteriores?|instru[cç][õo]es|sistema)\b/i
  },
  {
    id: "secret-exfiltration",
    risk: "high",
    expression: /\b(reveal|show|exfiltrate|leak|revele|mostre|vaze)\b[\s\S]{0,80}\b(system\s+prompt|developer\s+message|api\s*key|secret|senha|segredo)\b/i
  },
  {
    id: "role-override",
    risk: "high",
    expression: /\b(you\s+are\s+now|act\s+as|developer\s+mode|ignore\s+safety|agora\s+voc[eê]\s+[eé]|modo\s+desenvolvedor)\b/i
  },
  {
    id: "instruction-execution",
    risk: "medium",
    expression: /\b(follow|obey|execute|siga|obede[cç]a|execute)\b[\s\S]{0,60}\b(instructions?|instru[cç][õo]es|commands?|comandos?)\b/i
  },
  {
    id: "encoded-payload",
    risk: "medium",
    expression: /(?:[A-Za-z0-9+/]{48,}={0,2})/
  }
];

const invisibleCharacters = /[\u200B-\u200D\u2060\uFEFF\u{E0000}-\u{E007F}]/gu;

/**
 * A cheap, explainable screening layer for untrusted documents. It intentionally
 * does not alter the original text or claim to be a complete injection defense.
 */
export function assessPromptInjection(text: string): PromptInjectionAssessment {
  const normalizedForScreening = text.normalize("NFKC");
  const signals = rules.filter((rule) => rule.expression.test(normalizedForScreening)).map((rule) => rule.id);

  if (invisibleCharacters.test(normalizedForScreening)) signals.push("invisible-unicode");
  invisibleCharacters.lastIndex = 0;

  const hasHighSignal = rules.some(
    (rule) => rule.risk === "high" && signals.includes(rule.id)
  );
  if (hasHighSignal || signals.length >= 3) {
    return { promptInjectionRisk: "high", signals };
  }
  if (signals.length > 0) return { promptInjectionRisk: "medium", signals };
  return { promptInjectionRisk: "low", signals: [] };
}

export function isSafeForAnswer(assessment: PromptInjectionAssessment): boolean {
  return assessment.promptInjectionRisk !== "high";
}
