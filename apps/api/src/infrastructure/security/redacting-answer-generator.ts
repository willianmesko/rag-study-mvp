import type { AnswerGenerator, ProviderUsageObserver } from "../../application/ports/answer-generator.js";
import { redactPii } from "../../domain/security/pii-redaction.js";

export class RedactingAnswerGenerator implements AnswerGenerator {
  constructor(private readonly inner: AnswerGenerator) {}

  async generate(question: string, context: string, signal?: AbortSignal, onUsage?: ProviderUsageObserver): Promise<string> {
    const answer = await this.inner.generate(redactPii(question).text, redactPii(context).text, signal, onUsage);
    return redactPii(answer).text;
  }

  async stream(question: string, context: string, onDelta: (delta: string) => void | Promise<void>, signal?: AbortSignal, onUsage?: ProviderUsageObserver): Promise<string> {
    const safeOnDelta = (delta: string) => {
      signal?.throwIfAborted();
      return onDelta(redactPii(delta).text);
    };
    if (this.inner.stream) {
      const answer = await this.inner.stream(redactPii(question).text, redactPii(context).text, safeOnDelta, signal, onUsage);
      return redactPii(answer).text;
    }
    const answer = await this.generate(question, context, signal, onUsage);
    for (const delta of answer.match(/.{1,48}(?:\s+|$)/g) ?? [answer]) await safeOnDelta(delta);
    return answer;
  }
}
