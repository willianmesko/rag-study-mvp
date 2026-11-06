export interface EmbeddingProvider {
  embed(text: string, inputType: "document" | "query"): Promise<number[]>;
}

