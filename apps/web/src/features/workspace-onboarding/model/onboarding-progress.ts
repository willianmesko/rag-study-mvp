import { workspaceGuideSteps, workspaceOnboardingProgressSchema, type WorkspaceOnboardingProgress } from "@rag-study/contracts";

export const initialProgress: WorkspaceOnboardingProgress = { goal: null, step: "purpose", completed: false };
export type LocalOnboarding = { progress: WorkspaceOnboardingProgress; pending: "edit" | "legacy" | null };

export function sameProgress(left: WorkspaceOnboardingProgress, right: WorkspaceOnboardingProgress) {
  return left.goal === right.goal && left.step === right.step && left.completed === right.completed;
}

export function readOnboarding(userId?: string, workspaceId?: string): LocalOnboarding {
  if (userId && workspaceId) {
    const scope = `${userId}:${workspaceId}`;
    try {
      const cached = JSON.parse(window.localStorage.getItem(`lumora-onboarding-v3:${scope}`) ?? "null");
      const parsed = workspaceOnboardingProgressSchema.safeParse(cached?.progress);
      if (parsed.success) {
        const pending = cached.pending === "edit" || cached.pending === "legacy" ? cached.pending : null;
        return { progress: parsed.data, pending };
      }
    } catch { /* Try the older browser keys when available. */ }

    try {
      const completed = window.localStorage.getItem(`lumora-setup-completed:${scope}`) === "done";
      let previous: Record<string, unknown> | null = null;
      try { previous = JSON.parse(window.localStorage.getItem(`lumora-onboarding-v2:${scope}`) ?? "null"); } catch { /* The completion marker is independent. */ }
      const parsed = workspaceOnboardingProgressSchema.safeParse({
        goal: previous?.goal ?? (completed ? "custom" : null),
        step: completed ? "answer" : previous?.step ?? "purpose",
        completed
      });
      if (parsed.success && !sameProgress(parsed.data, initialProgress)) return { progress: parsed.data, pending: "legacy" };
      if (completed) return { progress: { goal: "custom", step: "answer", completed: true }, pending: "legacy" };
    } catch { /* Browser storage is optional. */ }
  }
  return { progress: initialProgress, pending: null };
}

export function storeOnboarding(userId: string, workspaceId: string, snapshot: LocalOnboarding) {
  try {
    window.localStorage.setItem(`lumora-onboarding-v3:${userId}:${workspaceId}`, JSON.stringify(snapshot));
  } catch { /* The current session can still use its query cache. */ }
}

export function shouldSyncOnboarding(local: LocalOnboarding, remote: WorkspaceOnboardingProgress | null | undefined) {
  if (!local.pending || remote?.completed) return false;
  if (!remote || local.progress.completed) return true;
  const localStep = workspaceGuideSteps.indexOf(local.progress.step);
  const remoteStep = workspaceGuideSteps.indexOf(remote.step);
  const goalChanged = local.progress.goal !== remote.goal && (local.pending === "edit" || remote.goal === null);
  return localStep > remoteStep || (localStep === remoteStep && goalChanged);
}
