import type { AnswerGenerator } from "../../application/ports/answer-generator.js";
import { redactPii } from "../../domain/security/pii-redaction.js";

export class RedactingAnswerGenerator implements AnswerGenerator {
  constructor(private readonly inner: AnswerGenerator) {}

  async generate(question: string, context: string): Promise<string> {
    const answer = await this.inner.generate(redactPii(question).text, redactPii(context).text);
    return redactPii(answer).text;
  }

  async stream(question: string, context: string, onDelta: (delta: string) => void | Promise<void>): Promise<string> {
    const safeOnDelta = (delta: string) => onDelta(redactPii(delta).text);
    if (this.inner.stream) {
      const answer = await this.inner.stream(redactPii(question).text, redactPii(context).text, safeOnDelta);
      return redactPii(answer).text;
    }
    const answer = await this.generate(question, context);
    for (const delta of answer.match(/.{1,48}(?:\s+|$)/g) ?? [answer]) await safeOnDelta(delta);
    return answer;
  }
}
