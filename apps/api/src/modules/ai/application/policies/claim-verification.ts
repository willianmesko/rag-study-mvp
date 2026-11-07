import type { FaithfulnessJudge } from "../../../evaluations/index.js";
import type {
  ClaimVerification,
  ClaimVerifier,
} from "../ports/claim-verifier.js";
import type { Citation } from "../../../knowledge/index.js";
import { WorkflowGuardError } from "../../../../platform/workflows/types.js";

const normalize = (value: string) =>
  value.normalize("NFC").replace(/\s+/gu, " ").trim().toLowerCase();
const content = (value: string) =>
  normalize(value)
    .replace(/\[S\d+\]/giu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");

/** A judge is evidence assessment, not proof of truth. Missing claims/quotes fail closed. */
export class GroundedClaimVerifier implements ClaimVerifier {
  readonly requiresExtractiveAnswer: boolean;
  constructor(private readonly judge?: FaithfulnessJudge) {
    this.requiresExtractiveAnswer = !judge;
  }
  async verify(
    answer: string,
    sources: readonly Citation[],
    signal: AbortSignal,
  ): Promise<ClaimVerification> {
    signal.throwIfAborted();
    if (!this.judge) {
      const sentences = answer
        .split(/(?<=[.!?])\s+|\n+/u)
        .map((line) => line.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)/u, "").trim())
        .filter(Boolean);
      const unsupported = sentences.filter(
        (sentence) =>
          !sources.some(({ content: passage }) =>
            normalize(passage).includes(normalize(sentence)),
          ),
      ).length;
      return {
        method: "extractive",
        supported: sentences.length > 0 && unsupported === 0,
        claims: sentences.length,
        unsupported,
      };
    }
    try {
      const claims = await this.judge.assess(
        { answer, passages: sources.map(({ content }) => content) },
        signal,
      );
      signal.throwIfAborted();
      if (!claims.length || claims.length > 16)
        return {
          method: "judge",
          supported: false,
          claims: claims.length,
          unsupported: Math.max(1, claims.length),
        };
      const normalized = normalize(answer);
      const seen = new Set<string>();
      let unsupported = 0;
      let uncovered = normalized;
      for (const { claim, evidence } of [...claims].sort(
        (a, b) => b.claim.length - a.claim.length,
      )) {
        const text = normalize(claim),
          quote = evidence ? normalize(evidence) : "";
        const valid =
          text.length > 0 &&
          !seen.has(text) &&
          normalized.includes(text) &&
          quote.length >= 12 &&
          sources.some(({ content: passage }) =>
            normalize(passage).includes(quote),
          );
        seen.add(text);
        if (!valid) unsupported++;
        if (valid) uncovered = uncovered.replace(text, "");
      }
      // The judge must account for every substantive part of the answer, not cherry-pick a supported fragment.
      if (content(uncovered)) unsupported++;
      return {
        method: "judge",
        supported: unsupported === 0,
        claims: claims.length,
        unsupported,
      };
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof WorkflowGuardError) throw error;
      return { method: "judge", supported: false, claims: 0, unsupported: 1 };
    }
  }
}
