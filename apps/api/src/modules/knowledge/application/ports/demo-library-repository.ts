import type { DemoSourceState } from "@rag-study/contracts";

export interface DemoLibraryRepository {
  sourceStates(tenantId: string, sources: readonly string[]): Promise<DemoSourceState[]>;
}
