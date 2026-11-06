import type { Citation } from "../../domain/document.js";

export type SemanticCacheEntry = { answer: string; sources: Citation[]; similarity: number };

export interface SemanticAnswerCache {
  findSimilar(input: { tenantId: string; embedding: number[]; minimumSimilarity: number }): Promise<SemanticCacheEntry | null>;
  put(input: { tenantId: string; questionHash: string; embedding: number[]; answer: string; sources: Citation[]; expiresAt: Date }): Promise<void>;
  invalidateTenant(tenantId: string): Promise<void>;
}
