import { z } from "zod";
import type { AnswerGenerator } from "../../application/ports/answer-generator.js";
import { createGroundedAnswerPrompt } from "../../application/policies/grounded-answer-policy.js";
import { requestProviderJson } from "../http/provider-client.js";
import { config } from "../../config.js";

const responseSchema = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1) });

export class OpenRouterAnswerGenerator implements AnswerGenerator {
  constructor(private readonly baseUrl: string, private readonly apiKey: string, private readonly model: string, private readonly maxOutputTokens = 500) {}

  async generate(question: string, context: string): Promise<string> {
    const prompt = createGroundedAnswerPrompt(question, context);
    const json = await requestProviderJson(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxOutputTokens,
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

  async stream(question: string, context: string, onDelta: (delta: string) => void | Promise<void>): Promise<string> {
    const prompt = createGroundedAnswerPrompt(question, context);
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxOutputTokens,
        temperature: 0,
        stream: true,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user }
        ]
      }),
      signal: AbortSignal.timeout(config.PROVIDER_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`OpenRouter streaming request failed (${response.status}).`);
    if (!response.body) throw new Error("OpenRouter did not return a streaming body.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    const consumeLine = async (line: string) => {
      if (!line.startsWith("data:")) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") return;
      const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string | null } }> };
      const delta = parsed.choices?.[0]?.delta?.content ?? "";
      if (!delta) return;
      answer += delta;
      await onDelta(delta);
    };
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) await consumeLine(line);
      if (done) break;
    }
    if (buffer) await consumeLine(buffer);
    if (!answer.trim()) throw new Error("OpenRouter returned an empty streaming response.");
    return answer.trim();
  }
}
