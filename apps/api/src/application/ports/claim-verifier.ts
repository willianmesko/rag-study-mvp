import type { Citation } from "../../domain/document.js";
export type ClaimVerification = {
  method: "judge" | "extractive";
  supported: boolean;
  claims: number;
  unsupported: number;
};
export interface ClaimVerifier {
  readonly requiresExtractiveAnswer: boolean;
  verify(
    answer: string,
    sources: readonly Citation[],
    signal: AbortSignal,
  ): Promise<ClaimVerification>;
}
