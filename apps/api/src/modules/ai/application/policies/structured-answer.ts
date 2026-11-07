import { z } from "zod";

export const groundedAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(20_000),
  citedChunkIds: z.array(z.string().min(1).max(200)).max(50).default([]),
  refusalReason: z.string().trim().min(1).max(500).nullable().optional()
});

export type GroundedAnswer = z.infer<typeof groundedAnswerSchema>;

export type ParsedGroundedAnswer = GroundedAnswer & {
  structured: boolean;
};

export const invalidCitationsAnswer = "I could not safely validate the sources returned by the model, so I am declining to answer.";

function removeCodeFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

/**
 * Providers return text, so the application validates the model's JSON at the
 * workflow boundary. The plain-text fallback keeps older/local models usable,
 * but marks the result as unstructured so a stricter production policy can
 * reject it later without changing the provider ports.
 */
export function parseGroundedAnswer(raw: string): ParsedGroundedAnswer {
  const normalized = raw.trim();
  if (!normalized) throw new Error("The model returned an empty answer.");
  try {
    const parsed = groundedAnswerSchema.parse(JSON.parse(removeCodeFence(normalized)));
    return { ...parsed, structured: true };
  } catch {
    return { answer: normalized, citedChunkIds: [], refusalReason: null, structured: false };
  }
}

export function validateGroundedAnswer(answer: ParsedGroundedAnswer, allowedReferences: ReadonlySet<string>): ParsedGroundedAnswer {
  const missingCitations = answer.structured && !answer.refusalReason && answer.citedChunkIds.length === 0;
  if (!missingCitations && answer.citedChunkIds.every((reference) => allowedReferences.has(reference))) return answer;
  return {
    answer: invalidCitationsAnswer,
    citedChunkIds: [],
    refusalReason: "invalid_citations",
    structured: answer.structured
  };
}
