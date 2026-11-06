export interface DocumentTextExtractor {
  extract(input: { filename: string; mimeType: string; payload: Buffer }): Promise<{
    text: string;
    metadata: Record<string, string | boolean>;
  }>;
}
