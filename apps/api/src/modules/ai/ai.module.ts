import type { config } from "../../config.js";
import type { Reranker } from "./application/ports/reranker.js";
import type { AnswerGenerator } from "./application/ports/answer-generator.js";
import { JinaReranker } from "./infrastructure/jina/jina-reranker.js";
import { PassThroughReranker } from "./infrastructure/reranking/pass-through-reranker.js";
import { OllamaAnswerGenerator } from "./infrastructure/ollama/ollama-answer-generator.js";
import { OpenRouterAnswerGenerator } from "./infrastructure/openrouter/openrouter-answer-generator.js";
import { BedrockAnswerGenerator } from "./infrastructure/bedrock/bedrock-answer-generator.js";
import { createBedrockClient } from "../../platform/ai/bedrock-client.js";
import { WorkflowAnswerGenerator, WorkflowFaithfulnessJudge } from "./infrastructure/security/workflow-provider-guards.js";
import { RedactingAnswerGenerator } from "./infrastructure/security/redacting-answer-generator.js";
import { OpenRouterFaithfulnessJudge } from "./infrastructure/openrouter/openrouter-faithfulness-judge.js";
import { GroundedClaimVerifier } from "./application/policies/claim-verification.js";
import type { ModelRuntimeMeasurements, ModelRuntimeProviders } from "./application/ports/model-runtime-providers.js";

type RerankerConfiguration = Pick<typeof config, "RERANKER_PROVIDER" | "JINA_BASE_URL" | "JINA_API_KEY" | "JINA_RERANKER_MODEL">;
type ChatProviderConfiguration = Pick<typeof config, "OLLAMA_BASE_URL" | "OPENROUTER_BASE_URL" | "OPENROUTER_API_KEY" | "AWS_REGION">;
type ModelRuntimeConfiguration = ChatProviderConfiguration & Pick<typeof config, "RAG_CLAIM_MODE" | "EVAL_FAITHFULNESS_JUDGE_MODEL" | "EVAL_JUDGE_INPUT_COST_PER_1K_USD" | "EVAL_JUDGE_OUTPUT_COST_PER_1K_USD">;

export function createModelRuntimeProviders(configuration: ModelRuntimeConfiguration, measurements: ModelRuntimeMeasurements): ModelRuntimeProviders {
  return {
    createAnswer(input) {
      const { provider, model, inputCostPer1kUsd, outputCostPer1kUsd, maxOutputTokens, checkpointKey } = input;
      return new WorkflowAnswerGenerator(
        measurements.evaluationGenerator(new RedactingAnswerGenerator(createAnswerGenerator(provider, model, maxOutputTokens, configuration)), {
          provider, model, inputPrice: inputCostPer1kUsd, outputPrice: outputCostPer1kUsd,
        }), checkpointKey, { inputCostPer1kUsd, outputCostPer1kUsd }, maxOutputTokens,
      );
    },
    createClaimVerifier(input) {
      const judge = input && configuration.RAG_CLAIM_MODE === "model" && input.provider === "openrouter"
        ? new WorkflowFaithfulnessJudge(measurements.judge(new OpenRouterFaithfulnessJudge(configuration.OPENROUTER_BASE_URL, configuration.OPENROUTER_API_KEY!, input.model), {
          provider: input.provider, model: input.model, inputPrice: input.inputCostPer1kUsd, outputPrice: input.outputCostPer1kUsd,
        }, "evidence_judging"), { inputCostPer1kUsd: input.inputCostPer1kUsd, outputCostPer1kUsd: input.outputCostPer1kUsd })
        : undefined;
      return new GroundedClaimVerifier(judge);
    },
    createEvaluationJudge() {
      const model = configuration.EVAL_FAITHFULNESS_JUDGE_MODEL;
      if (!model) return undefined;
      const inputCostPer1kUsd = configuration.EVAL_JUDGE_INPUT_COST_PER_1K_USD;
      const outputCostPer1kUsd = configuration.EVAL_JUDGE_OUTPUT_COST_PER_1K_USD;
      return new WorkflowFaithfulnessJudge(measurements.judge(new OpenRouterFaithfulnessJudge(configuration.OPENROUTER_BASE_URL, configuration.OPENROUTER_API_KEY as string, model), {
        provider: "openrouter", model, inputPrice: inputCostPer1kUsd, outputPrice: outputCostPer1kUsd,
      }, "evaluation_judging"), { inputCostPer1kUsd, outputCostPer1kUsd });
    },
  };
}

export function createReranker(configuration: RerankerConfiguration): Reranker {
  if (configuration.RERANKER_PROVIDER === "jina") {
    return new JinaReranker(
      configuration.JINA_BASE_URL,
      configuration.JINA_API_KEY as string,
      configuration.JINA_RERANKER_MODEL,
    );
  }
  return new PassThroughReranker();
}

export function createAnswerGenerator(
  provider: typeof config.CHAT_PROVIDER,
  model: string,
  maxOutputTokens: number,
  configuration: ChatProviderConfiguration,
): AnswerGenerator {
  switch (provider) {
    case "ollama":
      return new OllamaAnswerGenerator(
        configuration.OLLAMA_BASE_URL,
        model,
        maxOutputTokens,
      );
    case "openrouter":
      return new OpenRouterAnswerGenerator(
        configuration.OPENROUTER_BASE_URL,
        configuration.OPENROUTER_API_KEY as string,
        model,
        maxOutputTokens,
      );
    case "bedrock": {
      const bedrock = createBedrockClient(configuration.AWS_REGION, 1);
      return new BedrockAnswerGenerator(bedrock, model, maxOutputTokens);
    }
  }
}
