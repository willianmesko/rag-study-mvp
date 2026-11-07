export class EmbeddingIndexChangedError extends Error {
  constructor() {
    super("The workspace embedding index changed. Retry with its active version.");
    this.name = "EmbeddingIndexChangedError";
  }
}
