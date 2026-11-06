export const guideSteps = ["purpose", "knowledge", "answer"] as const;
export const guidePaths = ["legal", "it", "custom"] as const;

export type GuideStep = (typeof guideSteps)[number];
export type GuidePath = (typeof guidePaths)[number];
export type GuideProgress = { goal: GuidePath | null; step: GuideStep };

const initialProgress: GuideProgress = { goal: null, step: "purpose" };

export function readGuideProgress(storageKey: string): GuideProgress {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    if (!stored || typeof stored !== "object") return initialProgress;

    const state = stored as Record<string, unknown>;
    const goal = guidePaths.find((path) => path === state.goal);
    return goal
      ? { goal, step: guideSteps.find((step) => step === state.step) ?? "purpose" }
      : initialProgress;
  } catch {
    return initialProgress;
  }
}

export function saveGuideProgress(storageKey: string, progress: GuideProgress) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(progress));
  } catch {
    // The guide stays usable when the browser disables storage.
  }
}
