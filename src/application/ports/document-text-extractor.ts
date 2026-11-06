export interface DocumentTextExtractor {
  extract(input: { filename: string; mimeType: string; payload: Buffer }): Promise<string>;
}
