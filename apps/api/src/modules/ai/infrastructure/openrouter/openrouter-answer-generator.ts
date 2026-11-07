import type { ChatPromptVariantId } from "@rag-study/contracts";
import { z } from "zod";
import type { AnswerControls, AnswerGenerator, ProviderUsageObserver } from "../../application/ports/answer-generator.js";
import { createGroundedAnswerPrompt } from "../../application/policies/grounded-answer-policy.js";
import { maxProviderResponseBytes, defaultProviderHttpClient, type ProviderHttpClient } from "../../../../platform/http/provider-client.js";
import { IntegrationFailure } from "../../../../platform/integrations/retry-policy.js";

const responseEnvelope = z.object({ choices: z.unknown().optional(), usage: z.unknown().optional(), error: z.unknown().optional() });
const answerChoice = z.object({ message: z.object({ content: z.string().nullable() }) });
const streamChoice = z.object({
  delta: z.object({ content: z.string().nullable().optional() }).optional(),
  finish_reason: z.string().nullable().optional()
});
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
  constructor(private readonly baseUrl: string, private readonly apiKey: string, private readonly model: string, private readonly maxOutputTokens = 500, private readonly http: ProviderHttpClient = defaultProviderHttpClient) {}

  async generate(question: string, context: string, signal?: AbortSignal, onUsage?: ProviderUsageObserver, previousQuestions?: readonly string[], promptVariant?: ChatPromptVariantId, controls?:AnswerControls): Promise<string> {
    const prompt = createGroundedAnswerPrompt(question, context, previousQuestions, promptVariant, controls);
    const json = await this.http.requestJson(`${this.baseUrl}/chat/completions`, {
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
    const envelope = responseEnvelope.safeParse(json);
    if (!envelope.success) throw new IntegrationFailure("invalid_response");
    publishUsage(envelope.data.usage, onUsage);
    if (!Array.isArray(envelope.data.choices) || envelope.data.choices.length !== 1)
      throw new IntegrationFailure("invalid_response");
    const parsed = answerChoice.safeParse(envelope.data.choices[0]);
    if (!parsed.success || envelope.data.error) throw new IntegrationFailure("invalid_response");
    const answer = parsed.data.message.content?.trim();
    if (!answer) throw new Error("OpenRouter returned an empty chat response.");
    return answer;
  }

  async stream(question: string, context: string, onDelta: (delta: string) => void | Promise<void>, signal?: AbortSignal, onUsage?: ProviderUsageObserver, previousQuestions?: readonly string[], controls?:AnswerControls): Promise<string> {
    const prompt = createGroundedAnswerPrompt(question, context, previousQuestions, undefined, controls);
    const response = await this.http.requestResponse(`${this.baseUrl}/chat/completions`, {
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
      let value: unknown;
      try { value = JSON.parse(payload); }
      catch { throw new IntegrationFailure("invalid_response"); }
      const envelope = responseEnvelope.safeParse(value);
      if (!envelope.success) throw new IntegrationFailure("invalid_response");
      publishUsage(envelope.data.usage, onUsage);
      if (envelope.data.error) throw new Error("OpenRouter could not finish streaming the answer.");
      const choices = envelope.data.choices;
      if (choices !== undefined && (!Array.isArray(choices) || choices.length > 1))
        throw new IntegrationFailure("invalid_response");
      if (!choices?.length) return;
      const parsed = streamChoice.safeParse(choices[0]);
      if (!parsed.success) throw new IntegrationFailure("invalid_response");
      if (parsed.data.finish_reason === "error") throw new Error("OpenRouter could not finish streaming the answer.");
      const delta = parsed.data.delta?.content ?? "";
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
