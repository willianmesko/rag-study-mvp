import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const magic = Buffer.from("LUMORAK2");
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$/;
const maximum = 16 * 1024 * 1024;
export type WorkflowKeyring = {
  activeKeyId: string;
  keys: Record<string, string>;
  legacyKey?: string;
};
function key(value: string) {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== value)
    throw new Error(
      "Workflow encryption requires canonical base64 32-byte keys.",
    );
  return bytes;
}

/** Header and tenant/run identity are authenticated. Secrets never become enumerable. */
export class WorkflowStateCodec {
  readonly #keys = new Map<string, Buffer>();
  readonly #legacy?: Buffer;
  readonly #active?: string;
  constructor(encoded: string | WorkflowKeyring) {
    if (typeof encoded === "string") {
      this.#legacy = key(encoded);
      return;
    }
    const entries = Object.entries(encoded.keys);
    if (
      !idPattern.test(encoded.activeKeyId) ||
      entries.length < 1 ||
      entries.length > 8
    )
      throw new Error("Invalid workflow keyring.");
    for (const [id, value] of entries) {
      if (!idPattern.test(id) || id === "legacy")
        throw new Error("Invalid workflow key ID.");
      this.#keys.set(id, key(value));
    }
    if (!this.#keys.has(encoded.activeKeyId))
      throw new Error("The active workflow key is missing.");
    this.#active = encoded.activeKeyId;
    this.#legacy = encoded.legacyKey ? key(encoded.legacyKey) : undefined;
  }
  get activeKeyId() {
    return this.#active ?? "legacy";
  }
  get activeEnvelopePrefix() {
    return this.#active
      ? Buffer.concat([
          magic,
          Buffer.from([this.#active.length]),
          Buffer.from(this.#active),
        ])
      : Buffer.alloc(0);
  }
  keyId(bytes: Buffer): string {
    if (!bytes.subarray(0, magic.length).equals(magic)) return "legacy";
    const length = bytes[magic.length] ?? 0;
    const id = bytes
      .subarray(magic.length + 1, magic.length + 1 + length)
      .toString("ascii");
    if (
      length < 1 ||
      length > 40 ||
      !idPattern.test(id) ||
      bytes.length < magic.length + 1 + length + 28
    )
      throw new Error("Invalid workflow encryption envelope.");
    return id;
  }
  encode(bytes: Uint8Array, identity: readonly string[]): Buffer {
    if (bytes.byteLength > maximum)
      throw new Error("Workflow state exceeds its size limit.");
    const header = this.#active
      ? Buffer.concat([
          magic,
          Buffer.from([this.#active.length]),
          Buffer.from(this.#active),
        ])
      : Buffer.alloc(0);
    const selected = this.#active ? this.#keys.get(this.#active) : this.#legacy;
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", selected!, iv);
    cipher.setAAD(
      Buffer.concat([header, Buffer.from(JSON.stringify(identity))]),
    );
    return Buffer.concat([
      header,
      iv,
      cipher.update(bytes),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
  }
  decode(bytes: Buffer, identity: readonly string[]): Buffer {
    if (bytes.length < 28 || bytes.length > maximum + 100)
      throw new Error("Invalid workflow state.");
    const id = this.keyId(bytes),
      headerLength = id === "legacy" ? 0 : magic.length + 1 + id.length;
    const selected = id === "legacy" ? this.#legacy : this.#keys.get(id);
    if (!selected)
      throw new Error("A required workflow encryption key is unavailable.");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      selected,
      bytes.subarray(headerLength, headerLength + 12),
    );
    decipher.setAAD(
      Buffer.concat([
        bytes.subarray(0, headerLength),
        Buffer.from(JSON.stringify(identity)),
      ]),
    );
    decipher.setAuthTag(bytes.subarray(-16));
    try {
      return Buffer.concat([
        decipher.update(bytes.subarray(headerLength + 12, -16)),
        decipher.final(),
      ]);
    } catch {
      throw new Error("Workflow state authentication failed.");
    }
  }
  reencrypt(bytes: Buffer, identity: readonly string[]): Buffer {
    const plain = this.decode(bytes, identity),
      encoded = this.encode(plain, identity);
    if (!this.decode(encoded, identity).equals(plain))
      throw new Error("Workflow rotation verification failed.");
    return encoded;
  }
  json(value: unknown, identity: readonly string[]) {
    return this.encode(Buffer.from(JSON.stringify(value)), identity);
  }
  parse(bytes: Buffer, identity: readonly string[]): unknown {
    return JSON.parse(this.decode(bytes, identity).toString("utf8"));
  }
}

export function workflowCodecFromEnvironment(input: {
  WORKFLOW_STATE_KEY?: string;
  WORKFLOW_STATE_KEYS?: string;
  WORKFLOW_STATE_ACTIVE_KEY_ID?: string;
}) {
  if (input.WORKFLOW_STATE_KEYS || input.WORKFLOW_STATE_ACTIVE_KEY_ID) {
    if (!input.WORKFLOW_STATE_KEYS || !input.WORKFLOW_STATE_ACTIVE_KEY_ID)
      throw new Error("Both workflow keyring settings are required.");
    let keys: unknown;
    try {
      keys = JSON.parse(input.WORKFLOW_STATE_KEYS);
    } catch {
      throw new Error("Invalid workflow keyring JSON.");
    }
    if (
      !keys ||
      typeof keys !== "object" ||
      Array.isArray(keys) ||
      Object.values(keys).some((value) => typeof value !== "string")
    )
      throw new Error("Invalid workflow keyring JSON.");
    return new WorkflowStateCodec({
      activeKeyId: input.WORKFLOW_STATE_ACTIVE_KEY_ID,
      keys: keys as Record<string, string>,
      legacyKey: input.WORKFLOW_STATE_KEY,
    });
  }
  if (!input.WORKFLOW_STATE_KEY)
    throw new Error("A workflow encryption key is required.");
  return new WorkflowStateCodec(input.WORKFLOW_STATE_KEY);
}
