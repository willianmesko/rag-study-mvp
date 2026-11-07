import type { ChatPromptVariantId } from "@rag-study/contracts";
import { z } from "zod";
import type { AnswerGenerator, ProviderUsageObserver } from "../../application/ports/answer-generator.js";
import { createGroundedAnswerPrompt } from "../../application/policies/grounded-answer-policy.js";
import { providerRequestSignal, requestProviderJson } from "../http/provider-client.js";

const responseSchema = z.object({ message: z.object({ content: z.string() }), prompt_eval_count: z.unknown().optional(), eval_count: z.unknown().optional() });
const usageSchema = z.object({
  prompt_eval_count: z.number().int().min(0).max(2_147_483_647),
  eval_count: z.number().int().min(0).max(2_147_483_647)
});

function publishUsage(raw: unknown, onUsage?: ProviderUsageObserver) {
  if (!onUsage) return;
  const usage = usageSchema.safeParse(raw);
  if (usage.success) onUsage({ inputTokens: usage.data.prompt_eval_count, outputTokens: usage.data.eval_count });
}

export class OllamaAnswerGenerator implements AnswerGenerator {
  constructor(private readonly baseUrl: string, private readonly model: string, private readonly maxOutputTokens = 500) {}

  async generate(question: string, context: string, signal?: AbortSignal, onUsage?: ProviderUsageObserver, previousQuestions?: readonly string[], promptVariant?: ChatPromptVariantId): Promise<string> {
    const prompt = createGroundedAnswerPrompt(question, context, previousQuestions, promptVariant);
    const json = await requestProviderJson(`${this.baseUrl}/api/chat`, {
      method: "POST",
      signal,
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
    const parsed = responseSchema.parse(json);
    publishUsage(parsed, onUsage);
    const answer = parsed.message.content.trim();
    if (!answer) throw new Error("Ollama returned an empty chat response.");
    return answer;
  }

  async stream(question: string, context: string, onDelta: (delta: string) => void | Promise<void>, signal?: AbortSignal, onUsage?: ProviderUsageObserver, previousQuestions?: readonly string[]): Promise<string> {
    const prompt = createGroundedAnswerPrompt(question, context, previousQuestions);
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: true,
        options: { temperature: 0, num_predict: this.maxOutputTokens },
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user }
        ]
      }),
      signal: providerRequestSignal(signal)
    });
    if (!response.ok) throw new Error(`Ollama streaming request failed (${response.status}).`);
    if (!response.body) throw new Error("Ollama did not return a streaming body.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    let completed = false;
    const consumeLine = async (line: string) => {
      if (!line.trim()) return;
      const parsed = JSON.parse(line) as { error?: unknown; done?: boolean; message?: { content?: string }; response?: string };
      if (parsed.error) throw new Error("Ollama could not finish streaming the answer.");
      completed = parsed.done === true;
      if (completed) publishUsage(parsed, onUsage);
      const delta = parsed.message?.content ?? parsed.response ?? "";
      if (!delta) return;
      answer += delta;
      await onDelta(delta);
    };
    try {
      while (!completed) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          await consumeLine(line);
          if (completed) break;
        }
        if (done && !completed && buffer) await consumeLine(buffer);
        if (done) break;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    signal?.throwIfAborted();
    if (!completed) throw new Error("Ollama closed the stream before the answer was complete.");
    if (!answer.trim()) throw new Error("Ollama returned an empty streaming response.");
    return answer.trim();
  }
}
