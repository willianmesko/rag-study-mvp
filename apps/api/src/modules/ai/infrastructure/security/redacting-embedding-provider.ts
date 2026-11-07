import type {ProviderUsageObserver} from "../../application/ports/answer-generator.js";
import type { EmbeddingProvider } from "../../application/ports/embedding-provider.js";
import { redactPii } from "../../../../platform/security/pii-redaction.js";

export class RedactingEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly inner: EmbeddingProvider) {}

  embed(text: string, inputType: "document" | "query", signal?: AbortSignal,onUsage?:ProviderUsageObserver): Promise<number[]> {
    return this.inner.embed(redactPii(text).text, inputType, signal,onUsage);
  }
}
