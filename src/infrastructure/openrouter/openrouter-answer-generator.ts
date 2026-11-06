import { z } from "zod";
import type { AnswerGenerator } from "../../application/ports/answer-generator.js";
import { createGroundedAnswerPrompt } from "../../application/policies/grounded-answer-policy.js";
import { requestProviderJson } from "../http/provider-client.js";

const responseSchema = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1) });

export class OpenRouterAnswerGenerator implements AnswerGenerator {
  constructor(private readonly baseUrl: string, private readonly apiKey: string, private readonly model: string) {}

  async generate(question: string, context: string): Promise<string> {
    const prompt = createGroundedAnswerPrompt(question, context);
    const json = await requestProviderJson(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 500,
        temperature: 0,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user }
        ]
      })
    });
    const answer = responseSchema.parse(json).choices[0]?.message.content?.trim();
    if (!answer) throw new Error("OpenRouter returned an empty chat response.");
    return answer;
  }
}
