import type { ChatPromptVariantId } from "@rag-study/contracts";
import { z } from "zod";
import type { AnswerControls, AnswerGenerator, ProviderUsageObserver } from "../../application/ports/answer-generator.js";
import { createGroundedAnswerPrompt } from "../../application/policies/grounded-answer-policy.js";
import { maxProviderResponseBytes, requestProviderResponse, requestProviderJson } from "../../../../platform/http/provider-client.js";

const responseSchema = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1), usage: z.unknown().optional() });
const usageSchema = z.object({
  prompt_tokens: z.number().int().min(0).max(2_147_483_647),
  completion_tokens: z.number().int().min(0).max(2_147_483_647),
  cost: z.number().min(0).max(999_999).nullish()
});

function publishUsage(raw: unknown, onUsage?: ProviderUsageObserver) {
  if (!onUsage) return;
  const usage = usageSchema.safeParse(raw);
  if (usage.success) onUsage({
    inputTokens: usage.data.prompt_tokens, outputTokens: usage.data.completion_tokens,
    ...(usage.data.cost != null ? { costUsd: usage.data.cost } : {})
  });
}

export class OpenRouterAnswerGenerator implements AnswerGenerator {
  constructor(private readonly baseUrl: string, private readonly apiKey: string, private readonly model: string, private readonly maxOutputTokens = 500) {}

  async generate(question: string, context: string, signal?: AbortSignal, onUsage?: ProviderUsageObserver, previousQuestions?: readonly string[], promptVariant?: ChatPromptVariantId, controls?:AnswerControls): Promise<string> {
    const prompt = createGroundedAnswerPrompt(question, context, previousQuestions, promptVariant, controls);
    const json = await requestProviderJson(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      signal,
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxOutputTokens,
        temperature: 0,
        provider: { allow_fallbacks: false, require_parameters: true },
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user }
        ]
      })
    });
    const parsed = responseSchema.parse(json);
    publishUsage(parsed.usage, onUsage);
    const answer = parsed.choices[0]?.message.content?.trim();
    if (!answer) throw new Error("OpenRouter returned an empty chat response.");
    return answer;
  }

  async stream(question: string, context: string, onDelta: (delta: string) => void | Promise<void>, signal?: AbortSignal, onUsage?: ProviderUsageObserver, previousQuestions?: readonly string[], controls?:AnswerControls): Promise<string> {
    const prompt = createGroundedAnswerPrompt(question, context, previousQuestions, undefined, controls);
    const response = await requestProviderResponse(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxOutputTokens,
        temperature: 0,
        stream: true,
        provider: { allow_fallbacks: false, require_parameters: true },
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user }
        ]
      }),
      signal
    });
    if (!response.ok) throw new Error(`OpenRouter streaming request failed (${response.status}).`);
    if (!response.body) throw new Error("OpenRouter did not return a streaming body.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    let completed = false;
    let receivedBytes = 0;
    const consumeLine = async (line: string) => {
      if (!line.startsWith("data:")) return;
      const payload = line.slice(5).trim();
      if (!payload) return;
      if (payload === "[DONE]") {
        completed = true;
        return;
      }
      const parsed = JSON.parse(payload) as { error?: unknown; usage?: unknown; choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string }> };
      publishUsage(parsed.usage, onUsage);
      if (parsed.error || parsed.choices?.[0]?.finish_reason === "error") throw new Error("OpenRouter could not finish streaming the answer.");
      const delta = parsed.choices?.[0]?.delta?.content ?? "";
      if (!delta) return;
      answer += delta;
      await onDelta(delta);
    };
    try {
      while (!completed) {
        const { done, value } = await reader.read();
        receivedBytes += value?.byteLength ?? 0;
        if (receivedBytes > maxProviderResponseBytes) throw new Error('The provider stream exceeded its size limit.');
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
    if (!completed) throw new Error("OpenRouter closed the stream before the answer was complete.");
    if (!answer.trim()) throw new Error("OpenRouter returned an empty streaming response.");
    return answer.trim();
  }
}
