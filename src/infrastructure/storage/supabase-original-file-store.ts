import { createClient } from "@supabase/supabase-js";
import type { OriginalFileStore } from "../../application/ports/original-file-store.js";

export class SupabaseOriginalFileStore implements OriginalFileStore {
  private readonly client;
  constructor(url: string | undefined, serviceRoleKey: string | undefined, private readonly bucket: string) {
    this.client = url && serviceRoleKey ? createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  }
  isEnabled() { return this.client !== null; }
  async put(input: { path: string; contentType: string; payload: Buffer }) {
    if (!this.client) throw new Error("Private file storage is not configured.");
    const { error } = await this.client.storage.from(this.bucket).upload(input.path, input.payload, { contentType: input.contentType, upsert: false });
    if (error) throw new Error(`Unable to store original file: ${error.message}`);
  }
  async get(path: string) {
    if (!this.client) throw new Error("Private file storage is not configured.");
    const { data, error } = await this.client.storage.from(this.bucket).download(path);
    if (error || !data) throw new Error(`Unable to read original file: ${error?.message ?? "missing object"}`);
    return Buffer.from(await data.arrayBuffer());
  }
  async remove(path: string) {
    if (!this.client) return;
    const { error } = await this.client.storage.from(this.bucket).remove([path]);
    if (error) throw new Error(`Unable to remove original file: ${error.message}`);
  }
}
