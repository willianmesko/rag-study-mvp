import { z } from "zod";
import { decodeEmbeddingVector } from "../embeddings/embedding-response.js";
import { IntegrationFailure } from "../../../../platform/integrations/retry-policy.js";
import type {ProviderUsageObserver} from "../../application/ports/answer-generator.js";
import { InvokeModelCommand, type BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import type { EmbeddingProvider } from "../../application/ports/embedding-provider.js";
import { maxProviderResponseBytes, providerRequestSignal } from "../../../../platform/http/provider-client.js";

const embeddingResponse = z.object({ embedding: z.unknown() });
const nativeUsage = z.object({ inputTextTokenCount: z.number().int().min(0).max(2_147_483_647) });

export class TitanEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly client: BedrockRuntimeClient,
    private readonly modelId: string,
    private readonly dimensions: number,
    private readonly requestSignal: (signal?: AbortSignal | null) => AbortSignal = providerRequestSignal
  ) {}

  async embed(text: string, _inputType: "document" | "query", signal?: AbortSignal,onUsage?:ProviderUsageObserver): Promise<number[]> {
    const response = await this.client.send(
      new InvokeModelCommand({
        modelId: this.modelId,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({ inputText: text, dimensions: this.dimensions, normalize: true })
      }),
      { abortSignal: this.requestSignal(signal) }
    );
    if (!(response.body instanceof Uint8Array) || response.body.byteLength > maxProviderResponseBytes)
      throw new IntegrationFailure("invalid_response");
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder().decode(response.body)); }
    catch { throw new IntegrationFailure("invalid_response"); }
    // A valid native usage receipt still matters when the vector is unusable.
    const usage = nativeUsage.safeParse(payload);
    if (usage.success) onUsage?.({ inputTokens: usage.data.inputTextTokenCount, outputTokens: 0 });
    const parsed = embeddingResponse.safeParse(payload);
    if (!parsed.success) throw new IntegrationFailure("invalid_response");
    return decodeEmbeddingVector(parsed.data.embedding, this.dimensions);
  }
}

