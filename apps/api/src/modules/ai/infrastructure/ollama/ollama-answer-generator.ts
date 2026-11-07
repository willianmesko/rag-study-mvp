import type { ChatPromptVariantId } from "@rag-study/contracts";
import { z } from "zod";
import type { AnswerControls, AnswerGenerator, ProviderUsageObserver } from "../../application/ports/answer-generator.js";
import { createGroundedAnswerPrompt } from "../../application/policies/grounded-answer-policy.js";
import { maxProviderResponseBytes, defaultProviderHttpClient, type ProviderHttpClient } from "../../../../platform/http/provider-client.js";
import { IntegrationFailure } from "../../../../platform/integrations/retry-policy.js";

const responseSchema = z.object({ message: z.object({ content: z.string() }), prompt_eval_count: z.unknown().optional(), eval_count: z.unknown().optional() });
const streamResponseSchema = z.object({
  error: z.unknown().optional(), done: z.boolean().optional(),
  message: z.object({ content: z.string().nullable().optional() }).optional(),
  response: z.string().nullable().optional()
});
const completionEnvelope = z.object({ done: z.unknown().optional() });
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
  constructor(private readonly baseUrl: string, private readonly model: string, private readonly maxOutputTokens = 500, private readonly http: ProviderHttpClient = defaultProviderHttpClient) {}

  async generate(question: string, context: string, signal?: AbortSignal, onUsage?: ProviderUsageObserver, previousQuestions?: readonly string[], promptVariant?: ChatPromptVariantId, controls?:AnswerControls): Promise<string> {
    const prompt = createGroundedAnswerPrompt(question, context, previousQuestions, promptVariant, controls);
    const json = await this.http.requestJson(`${this.baseUrl}/api/chat`, {
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
    publishUsage(json, onUsage);
    const parsed = responseSchema.safeParse(json);
    if (!parsed.success) throw new IntegrationFailure("invalid_response");
    const answer = parsed.data.message.content.trim();
    if (!answer) throw new Error("Ollama returned an empty chat response.");
    return answer;
  }

  async stream(question: string, context: string, onDelta: (delta: string) => void | Promise<void>, signal?: AbortSignal, onUsage?: ProviderUsageObserver, previousQuestions?: readonly string[], controls?:AnswerControls): Promise<string> {
    const prompt = createGroundedAnswerPrompt(question, context, previousQuestions, undefined, controls);
    const response = await this.http.requestResponse(`${this.baseUrl}/api/chat`, {
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
      signal
    });
    if (!response.ok) throw new Error(`Ollama streaming request failed (${response.status}).`);
    if (!response.body) throw new Error("Ollama did not return a streaming body.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    let completed = false;
    let receivedBytes = 0;
    const consumeLine = async (line: string) => {
      if (!line.trim()) return;
      let value: unknown;
      try { value = JSON.parse(line); }
      catch { throw new IntegrationFailure("invalid_response"); }
      // Accounting is independent of whether the terminal message is usable.
      const completion = completionEnvelope.safeParse(value);
      if (completion.success && completion.data.done === true) publishUsage(value, onUsage);
      const parsed = streamResponseSchema.safeParse(value);
      if (!parsed.success) throw new IntegrationFailure("invalid_response");
      if (parsed.data.error) throw new Error("Ollama could not finish streaming the answer.");
      completed = parsed.data.done === true;
      const delta = parsed.data.message?.content ?? parsed.data.response ?? "";
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
    if (!completed) throw new Error("Ollama closed the stream before the answer was complete.");
    if (!answer.trim()) throw new Error("Ollama returned an empty streaming response.");
    return answer.trim();
  }
}
