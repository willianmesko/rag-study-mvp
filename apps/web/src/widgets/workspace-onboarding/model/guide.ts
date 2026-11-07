import { workspaceGuideSteps as guideSteps, type WorkspaceOnboardingProgress } from "@rag-study/contracts";

export const guidePaths = ["knowledge", "support", "learning"] as const;
export { guideSteps };
export type GuideStep = (typeof guideSteps)[number];
export type GuidePath = (typeof guidePaths)[number];

export function resolveGuidePath(goal: WorkspaceOnboardingProgress["goal"]): GuidePath {
  switch (goal) {
    case "legal": return "knowledge";
    case "it": return "support";
    case "custom": return "learning";
    default: return goal ?? "learning";
  }
}
