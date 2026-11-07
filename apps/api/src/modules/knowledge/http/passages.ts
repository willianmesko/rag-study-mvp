import { redactPii } from "../../../platform/security/pii-redaction.js";
import { isSafeForAnswer, type PromptInjectionAssessment } from "../../../platform/security/prompt-injection.js";

const maxPassageExcerptChars = 600;

function passageExcerpt(content: string) {
  const safeText = redactPii(content).text;
  const excerpt = safeText.slice(0, maxPassageExcerptChars).replace(/[\uD800-\uDBFF]$/u, "");
  return { excerpt, excerptTruncated: excerpt.length < safeText.length };
}

export function restrictedPassagePreview(content: string, security: PromptInjectionAssessment) {
  return isSafeForAnswer(security)
    ? { ...passageExcerpt(content), previewBlocked: false }
    : { excerpt: "", excerptTruncated: false, previewBlocked: true };
}
