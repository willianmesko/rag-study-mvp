export const guideSteps = ["purpose", "team", "knowledge", "processing", "answer", "understand"] as const;
export const guidePaths = ["legal", "it", "custom"] as const;

export type GuideStep = (typeof guideSteps)[number];
export type GuidePath = (typeof guidePaths)[number];

export type GuideProgress = {
  goal: GuidePath | null;
  completed: GuideStep[];
  current: GuideStep | null;
  collapsed: boolean;
};

export function readGuideProgress(storageKey: string): GuideProgress {
  const empty: GuideProgress = { goal: null, completed: [], current: null, collapsed: false };
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    if (!stored || typeof stored !== "object") return empty;

    const state = stored as Record<string, unknown>;
    const savedSteps: unknown[] = Array.isArray(state.completed) ? state.completed : [];
    return {
      goal: guidePaths.find((path) => path === state.goal) ?? null,
      completed: guideSteps.filter((step) => savedSteps.includes(step)),
      current: guideSteps.find((step) => step === state.current) ?? null,
      collapsed: state.collapsed === true
    };
  } catch {
    return empty;
  }
}

export function saveGuideProgress(storageKey: string, progress: GuideProgress) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(progress));
  } catch {
    // The guide stays usable when the browser disables storage.
  }
}
