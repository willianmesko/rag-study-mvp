import { createClient } from "@supabase/supabase-js";
import { providerRequestSignal } from "../../../../platform/http/provider-client.js";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { OriginalFileStore } from "../../application/ports/original-file-store.js";

export class SupabaseOriginalFileStore implements OriginalFileStore {
  private readonly client;
  private readonly reads = new AsyncLocalStorage<AbortSignal | undefined>();
  constructor(
    url: string | undefined,
    serviceRoleKey: string | undefined,
    private readonly bucket: string,
  ) {
    this.client =
      url && serviceRoleKey
        ? createClient(url, serviceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false },
            global: {
              fetch: (url, init) => {
                const parent = this.reads.getStore();
                const signal = parent && init?.signal ? AbortSignal.any([parent, init.signal]) : parent ?? init?.signal;
                return fetch(url, {
                  ...init,
                  redirect: "error",
                  signal: providerRequestSignal(signal),
                });
              },
            },
          })
        : null;
  }
  isEnabled() {
    return this.client !== null;
  }
  async put(input: { path: string; contentType: string; payload: Buffer }) {
    if (!this.client)
      throw new Error("Private file storage is not configured.");
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(input.path, input.payload, {
        contentType: input.contentType,
        upsert: false,
      });
    if (error) {
      // Retry of an accepted object upload must verify bytes instead of overwriting an original.
      try {
        const existing = await this.get(input.path);
        if (
          createHash("sha256").update(existing).digest("hex") ===
          createHash("sha256").update(input.payload).digest("hex")
        )
          return;
      } catch {
        /* A denied or unreadable original cannot satisfy idempotent acceptance. */
      }
      throw new Error("Unable to store original file.");
    }
  }
  async get(path: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!this.client)
      throw new Error("Private file storage is not configured.");
    return this.reads.run(signal, async () => {
      const { data, error } = await this.client!.storage.from(this.bucket).download(path);
      signal?.throwIfAborted();
      if (error || !data) throw new Error("Unable to read original file.");
      const payload = Buffer.from(await data.arrayBuffer());
      signal?.throwIfAborted();
      return payload;
    });
  }
  async remove(path: string) {
    if (!this.client) return;
    const { error } = await this.client.storage
      .from(this.bucket)
      .remove([path]);
    if (error) throw new Error("Unable to remove original file.");
  }
}
