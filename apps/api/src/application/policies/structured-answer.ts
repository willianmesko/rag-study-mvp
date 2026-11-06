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

export function validateGroundedAnswer(answer: ParsedGroundedAnswer, allowedChunkIds: ReadonlySet<string>): ParsedGroundedAnswer {
  const invalidChunkIds = answer.citedChunkIds.filter((chunkId) => !allowedChunkIds.has(chunkId));
  if (invalidChunkIds.length === 0) return answer;
  return {
    answer: "I could not safely validate the sources returned by the model, so I am declining to answer.",
    citedChunkIds: [],
    refusalReason: "invalid_citations",
    structured: answer.structured
  };
}
