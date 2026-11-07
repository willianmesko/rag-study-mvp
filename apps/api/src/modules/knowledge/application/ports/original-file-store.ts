export interface OriginalFileStore {
  isEnabled(): boolean;
  put(input: { path: string; contentType: string; payload: Buffer }): Promise<void>;
  get(path: string, signal?: AbortSignal): Promise<Buffer>;
  remove(path: string): Promise<void>;
}
