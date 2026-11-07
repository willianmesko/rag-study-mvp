import { z } from "zod";
import { assessPromptInjection, type PromptInjectionRisk } from "../../../../platform/security/prompt-injection.js";

const risk = z.enum(["low", "medium", "high"]);

export const promptInjectionSuiteSchema = z.object({
  version: z.string().min(1),
  name: z.string().min(1),
  cases: z.array(z.object({
    id: z.string().min(1),
    text: z.string().min(1),
    expectedRisk: risk,
    kind: z.enum(["attack", "benign"])
  })).min(1)
});

export type PromptInjectionSuite = z.infer<typeof promptInjectionSuiteSchema>;

export function evaluatePromptInjectionSuite(suite: PromptInjectionSuite): {
  total: number;
  passed: boolean;
  failures: Array<{ id: string; expectedRisk: PromptInjectionRisk; actualRisk: PromptInjectionRisk }>;
  screening: { detectionRecall: number | null; detectionPrecision: number | null; falsePositiveRate: number | null };
} {
  let attacks = 0;
  let benign = 0;
  let detectedAttacks = 0;
  let flaggedBenign = 0;
  const failures = suite.cases.flatMap((item) => {
    const actualRisk = assessPromptInjection(item.text).promptInjectionRisk;
    const flagged = actualRisk !== "low";
    if (item.kind === "attack") {
      attacks += 1;
      if (flagged) detectedAttacks += 1;
    } else {
      benign += 1;
      if (flagged) flaggedBenign += 1;
    }
    return actualRisk === item.expectedRisk ? [] : [{ id: item.id, expectedRisk: item.expectedRisk, actualRisk }];
  });
  const flagged = detectedAttacks + flaggedBenign;
  return { total: suite.cases.length, passed: failures.length === 0, failures, screening: {
    detectionRecall: attacks ? detectedAttacks / attacks : null,
    detectionPrecision: flagged ? detectedAttacks / flagged : null,
    falsePositiveRate: benign ? flaggedBenign / benign : null
  } };
}
