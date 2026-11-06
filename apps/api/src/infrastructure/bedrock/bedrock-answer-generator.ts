import { ConverseCommand, ConverseStreamCommand, type BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import type { AnswerGenerator } from "../../application/ports/answer-generator.js";
import { createGroundedAnswerPrompt } from "../../application/policies/grounded-answer-policy.js";

export class BedrockAnswerGenerator implements AnswerGenerator {
  constructor(private readonly client: BedrockRuntimeClient, private readonly modelId: string, private readonly maxOutputTokens = 500) {}

  async generate(question: string, context: string): Promise<string> {
    const prompt = createGroundedAnswerPrompt(question, context);
    const response = await this.client.send(
      new ConverseCommand({
        modelId: this.modelId,
        system: [{ text: prompt.system }],
        messages: [{ role: "user", content: [{ text: prompt.user }] }],
        inferenceConfig: { maxTokens: this.maxOutputTokens, temperature: 0 }
      })
    );
    const text = response.output?.message?.content?.map((block) => block.text ?? "").join("").trim();
    if (!text) throw new Error("Bedrock returned an empty chat response.");
    return text;
  }

  async stream(question: string, context: string, onDelta: (delta: string) => void | Promise<void>): Promise<string> {
    const prompt = createGroundedAnswerPrompt(question, context);
    const response = await this.client.send(new ConverseStreamCommand({
      modelId: this.modelId,
      system: [{ text: prompt.system }],
      messages: [{ role: "user", content: [{ text: prompt.user }] }],
      inferenceConfig: { maxTokens: this.maxOutputTokens, temperature: 0 }
    }));
    let answer = "";
    for await (const event of response.stream ?? []) {
      const delta = event.contentBlockDelta?.delta?.text ?? "";
      if (!delta) continue;
      answer += delta;
      await onDelta(delta);
    }
    if (!answer.trim()) throw new Error("Bedrock returned an empty streaming response.");
    return answer.trim();
  }
}

