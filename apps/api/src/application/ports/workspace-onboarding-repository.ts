import type { WorkspaceOnboardingProgress } from "@rag-study/contracts";

export type WorkspaceOnboardingScope = { tenantId: string; userId: string };

export interface WorkspaceOnboardingRepository {
  get(scope: WorkspaceOnboardingScope): Promise<WorkspaceOnboardingProgress | null>;
  save(scope: WorkspaceOnboardingScope, progress: WorkspaceOnboardingProgress): Promise<WorkspaceOnboardingProgress>;
}
