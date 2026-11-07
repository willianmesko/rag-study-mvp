import { z } from "zod";

export const evaluationEffortSchema = z.enum(["compact", "standard", "extended"]);
export type EvaluationEffort = z.infer<typeof evaluationEffortSchema>;

// Evaluation profiles preserve the question, prompt, and evidence. The answer
// output limit is the only variable, including for non-reasoning models.
export const evaluationOutputLimits: Record<EvaluationEffort, number> = {
  compact: 160,
  standard: 320,
  extended: 500
};
