import { z } from "zod";
import { assessPromptInjection, type PromptInjectionRisk } from "../../domain/security/prompt-injection.js";

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
} {
  const failures = suite.cases.flatMap((item) => {
    const actualRisk = assessPromptInjection(item.text).promptInjectionRisk;
    return actualRisk === item.expectedRisk ? [] : [{ id: item.id, expectedRisk: item.expectedRisk, actualRisk }];
  });
  return { total: suite.cases.length, passed: failures.length === 0, failures };
}
