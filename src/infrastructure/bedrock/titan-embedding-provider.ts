import { InvokeModelCommand, type BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import type { EmbeddingProvider } from "../../application/ports/embedding-provider.js";

type TitanEmbeddingResponse = { embedding?: number[] };

export class TitanEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly client: BedrockRuntimeClient,
    private readonly modelId: string,
    private readonly dimensions: number
  ) {}

  async embed(text: string, _inputType: "document" | "query"): Promise<number[]> {
    const response = await this.client.send(
      new InvokeModelCommand({
        modelId: this.modelId,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({ inputText: text, dimensions: this.dimensions, normalize: true })
      })
    );
    const payload = JSON.parse(new TextDecoder().decode(response.body)) as TitanEmbeddingResponse;
    if (!payload.embedding || payload.embedding.length !== this.dimensions) {
      throw new Error(`Bedrock returned an invalid embedding. Expected ${this.dimensions} dimensions.`);
    }
    return payload.embedding;
  }
}

