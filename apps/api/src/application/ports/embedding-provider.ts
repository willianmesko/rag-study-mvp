export interface EmbeddingProvider {
  embed(text: string, inputType: "document" | "query", signal?: AbortSignal): Promise<number[]>;
}

