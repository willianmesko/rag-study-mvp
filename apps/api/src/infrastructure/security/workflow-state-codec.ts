import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Only encrypted workflow state is retained. AAD prevents swapping tenant/run records. */
export class WorkflowStateCodec {
  readonly #key: Buffer;
  constructor(encodedKey: string) {
    this.#key = Buffer.from(encodedKey, "base64");
    if (this.#key.length !== 32 || this.#key.toString("base64") !== encodedKey)
      throw new Error(
        "WORKFLOW_STATE_KEY must be a canonical base64 32-byte key.",
      );
  }
  encode(bytes: Uint8Array, identity: readonly string[]): Buffer {
    if (bytes.byteLength > 16 * 1024 * 1024)
      throw new Error("Workflow state exceeds its size limit.");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    cipher.setAAD(Buffer.from(JSON.stringify(identity)));
    return Buffer.concat([
      iv,
      cipher.update(bytes),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
  }
  decode(bytes: Buffer, identity: readonly string[]): Buffer {
    if (bytes.length < 28 || bytes.length > 16 * 1024 * 1024 + 28)
      throw new Error("Invalid workflow state.");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.#key,
      bytes.subarray(0, 12),
    );
    decipher.setAAD(Buffer.from(JSON.stringify(identity)));
    decipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([
      decipher.update(bytes.subarray(12, -16)),
      decipher.final(),
    ]);
  }
  json(value: unknown, identity: readonly string[]) {
    return this.encode(Buffer.from(JSON.stringify(value)), identity);
  }
  parse(bytes: Buffer, identity: readonly string[]): unknown {
    return JSON.parse(this.decode(bytes, identity).toString("utf8"));
  }
}
