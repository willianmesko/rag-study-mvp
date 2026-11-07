import { workspaceGuideGoals as guidePaths, workspaceGuideSteps as guideSteps } from "@rag-study/contracts";

export { guidePaths, guideSteps };
export type GuideStep = (typeof guideSteps)[number];
export type GuidePath = (typeof guidePaths)[number];
