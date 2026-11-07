import type { ChatPromptVariantId } from "@rag-study/contracts";
import { ConverseCommand, ConverseStreamCommand, type BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import type { AnswerControls, AnswerGenerator, ProviderUsageObserver } from "../../application/ports/answer-generator.js";
import { createGroundedAnswerPrompt } from "../../application/policies/grounded-answer-policy.js";
import { providerRequestSignal } from "../../../../platform/http/provider-client.js";

function publishUsage(usage: { inputTokens?: number; outputTokens?: number } | undefined, onUsage?: ProviderUsageObserver) {
  if (usage?.inputTokens !== undefined && usage.outputTokens !== undefined) {
    onUsage?.({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
  }
}

export class BedrockAnswerGenerator implements AnswerGenerator {
  constructor(private readonly client: BedrockRuntimeClient, private readonly modelId: string, private readonly maxOutputTokens = 500) {}

  async generate(question: string, context: string, signal?: AbortSignal, onUsage?: ProviderUsageObserver, previousQuestions?: readonly string[], promptVariant?: ChatPromptVariantId, controls?:AnswerControls): Promise<string> {
    const prompt = createGroundedAnswerPrompt(question, context, previousQuestions, promptVariant, controls);
    const response = await this.client.send(
      new ConverseCommand({
        modelId: this.modelId,
        system: [{ text: prompt.system }],
        messages: [{ role: "user", content: [{ text: prompt.user }] }],
        inferenceConfig: { maxTokens: this.maxOutputTokens, temperature: 0 }
      }),
      { abortSignal: providerRequestSignal(signal) }
    );
    publishUsage(response.usage, onUsage);
    const text = response.output?.message?.content?.map((block) => block.text ?? "").join("").trim();
    if (!text) throw new Error("Bedrock returned an empty chat response.");
    return text;
  }

  async stream(question: string, context: string, onDelta: (delta: string) => void | Promise<void>, signal?: AbortSignal, onUsage?: ProviderUsageObserver, previousQuestions?: readonly string[], controls?:AnswerControls): Promise<string> {
    const prompt = createGroundedAnswerPrompt(question, context, previousQuestions, undefined, controls);
    const requestSignal = providerRequestSignal(signal);
    const response = await this.client.send(new ConverseStreamCommand({
      modelId: this.modelId,
      system: [{ text: prompt.system }],
      messages: [{ role: "user", content: [{ text: prompt.user }] }],
      inferenceConfig: { maxTokens: this.maxOutputTokens, temperature: 0 }
    }), { abortSignal: requestSignal });
    let answer = "";
    let completed = false;
    for await (const event of response.stream ?? []) {
      requestSignal.throwIfAborted();
      if (event.messageStop) completed = true;
      publishUsage(event.metadata?.usage, onUsage);
      const delta = event.contentBlockDelta?.delta?.text ?? "";
      if (!delta) continue;
      answer += delta;
      await onDelta(delta);
    }
    requestSignal.throwIfAborted();
    if (!completed) throw new Error("Bedrock closed the stream before the answer was complete.");
    if (!answer.trim()) throw new Error("Bedrock returned an empty streaming response.");
    return answer.trim();
  }
}

