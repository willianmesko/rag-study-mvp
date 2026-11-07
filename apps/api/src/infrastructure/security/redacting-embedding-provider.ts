import type { EmbeddingProvider } from "../../application/ports/embedding-provider.js";
import { redactPii } from "../../domain/security/pii-redaction.js";

export class RedactingEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly inner: EmbeddingProvider) {}

  embed(text: string, inputType: "document" | "query", signal?: AbortSignal): Promise<number[]> {
    return this.inner.embed(redactPii(text).text, inputType, signal);
  }
}
