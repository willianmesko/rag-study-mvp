import { GroundedClaimVerifier } from "./application/policies/claim-verification.js";
import { RedactingAnswerGenerator } from "./application/services/redacting-answer-generator.js";
import type { ModelProviderRegistry, ModelRuntimeGuards, ModelRuntimeMeasurements, ModelRuntimeOptions, ModelRuntimeProviders } from "./application/ports/model-runtime-providers.js";

/** Assemble provider-independent policy around explicitly injected capabilities. */
export function createModelRuntimeProviders(dependencies: {
  registry: ModelProviderRegistry;
  guards: ModelRuntimeGuards;
  measurements: ModelRuntimeMeasurements;
  options: ModelRuntimeOptions;
}): ModelRuntimeProviders {
  const { registry, guards, measurements, options } = dependencies;
  return {
    createAnswer(input) {
      const { provider, model, inputCostPer1kUsd, outputCostPer1kUsd } = input;
      const redacting = new RedactingAnswerGenerator(registry.createAnswer(input));
      const measured = measurements.evaluationGenerator(redacting, {
        provider, model, inputPrice: inputCostPer1kUsd, outputPrice: outputCostPer1kUsd,
      });
      return guards.answer(measured, input);
    },
    createClaimVerifier(input) {
      const judge = input && options.claimMode === "model" ? registry.createJudge(input) : undefined;
      return new GroundedClaimVerifier(judge && input
        ? guards.judge(measurements.judge(judge, {
          provider: input.provider, model: input.model,
          inputPrice: input.inputCostPer1kUsd, outputPrice: input.outputCostPer1kUsd,
        }, "evidence_judging"), input)
        : undefined);
    },
    createEvaluationJudge() {
      const identity = options.evaluationJudge;
      if (!identity) return undefined;
      const judge = registry.createJudge(identity);
      if (!judge) return undefined;
      return guards.judge(measurements.judge(judge, {
        provider: identity.provider, model: identity.model,
        inputPrice: identity.inputCostPer1kUsd, outputPrice: identity.outputCostPer1kUsd,
      }, "evaluation_judging"), identity);
    },
  };
}
