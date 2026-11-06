export interface OriginalFileStore {
  isEnabled(): boolean;
  put(input: { path: string; contentType: string; payload: Buffer }): Promise<void>;
  get(path: string): Promise<Buffer>;
  remove(path: string): Promise<void>;
}
