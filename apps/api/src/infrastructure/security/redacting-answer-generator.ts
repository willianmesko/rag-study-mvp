import type { AnswerGenerator } from "../../application/ports/answer-generator.js";
import { redactPii } from "../../domain/security/pii-redaction.js";

export class RedactingAnswerGenerator implements AnswerGenerator {
  constructor(private readonly inner: AnswerGenerator) {}

  async generate(question: string, context: string): Promise<string> {
    const answer = await this.inner.generate(redactPii(question).text, redactPii(context).text);
    return redactPii(answer).text;
  }
}
