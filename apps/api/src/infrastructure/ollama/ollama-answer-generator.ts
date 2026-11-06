import { z } from "zod";
import type { AnswerGenerator } from "../../application/ports/answer-generator.js";
import { createGroundedAnswerPrompt } from "../../application/policies/grounded-answer-policy.js";
import { requestProviderJson } from "../http/provider-client.js";

const responseSchema = z.object({ message: z.object({ content: z.string() }) });

export class OllamaAnswerGenerator implements AnswerGenerator {
  constructor(private readonly baseUrl: string, private readonly model: string, private readonly maxOutputTokens = 500) {}

  async generate(question: string, context: string): Promise<string> {
    const prompt = createGroundedAnswerPrompt(question, context);
    const json = await requestProviderJson(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        options: { temperature: 0, num_predict: this.maxOutputTokens },
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user }
        ]
      })
    });
    const answer = responseSchema.parse(json).message.content.trim();
    if (!answer) throw new Error("Ollama returned an empty chat response.");
    return answer;
  }
}
