import type { ChatPromptVariantId } from "@rag-study/contracts";
import type { AnswerControls, AnswerGenerator, ProviderUsageObserver } from "../../application/ports/answer-generator.js";
import { redactPii } from "../../../../platform/security/pii-redaction.js";

export class RedactingAnswerGenerator implements AnswerGenerator {
  constructor(private readonly inner: AnswerGenerator) {}

  get checkpointKey() { return this.inner.checkpointKey; }

  async generate(question: string, context: string, signal?: AbortSignal, onUsage?: ProviderUsageObserver, previousQuestions?: readonly string[], promptVariant?: ChatPromptVariantId, controls?:AnswerControls): Promise<string> {
    const answer = await this.inner.generate(redactPii(question).text, redactPii(context).text, signal, onUsage,
      previousQuestions?.map((previous) => redactPii(previous).text), promptVariant, controls);
    return redactPii(answer).text;
  }

  async stream(question: string, context: string, onDelta: (delta: string) => void | Promise<void>, signal?: AbortSignal, onUsage?: ProviderUsageObserver, previousQuestions?: readonly string[], controls?:AnswerControls): Promise<string> {
    const safeOnDelta = (delta: string) => {
      signal?.throwIfAborted();
      return onDelta(redactPii(delta).text);
    };
    if (this.inner.stream) {
      const answer = await this.inner.stream(redactPii(question).text, redactPii(context).text, safeOnDelta, signal, onUsage,
        previousQuestions?.map((previous) => redactPii(previous).text), controls);
      return redactPii(answer).text;
    }
    const answer = await this.generate(question, context, signal, onUsage, previousQuestions, undefined, controls);
    for (const delta of answer.match(/.{1,48}(?:\s+|$)/g) ?? [answer]) await safeOnDelta(delta);
    return answer;
  }
}
