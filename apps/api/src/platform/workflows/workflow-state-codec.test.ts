import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { WorkflowStateCodec } from "./workflow-state-codec.js";
test("authenticated malformed JSON and invalid UTF-8 fail without exposing decrypted content", () => {
  const codec = new WorkflowStateCodec(randomBytes(32).toString("base64"));
  const scope = ["workspace", "actor", "run", "input"];
  for (const bytes of [Buffer.from('{"PRIVATE_SENTINEL":bad}'), Buffer.from([34, 0xc3, 0x28, 34])]) {
    const cipher = codec.encode(bytes, scope);
    assert.throws(() => codec.parse(cipher, scope), (error: unknown) => error instanceof Error &&
      error.message === "Workflow state JSON is invalid." && !("cause" in error) &&
      !String(error.stack).includes("PRIVATE_SENTINEL"));
  }
  assert.deepEqual(codec.parse(codec.json({ text: "Informação válida" }, scope), scope), { text: "Informação válida" });
});
test("private state cannot be swapped between workspaces or decrypted with another key", () => {
  const codec = new WorkflowStateCodec(randomBytes(32).toString("base64"));
  const scope = ["workspace-a", "actor", "run", "graph", "record"];
  const cipher = codec.json({ private: "private fixture paragraph" }, scope);
  assert.equal(
    cipher.includes(Buffer.from("private fixture paragraph")),
    false,
  );
  assert.deepEqual(codec.parse(cipher, scope), {
    private: "private fixture paragraph",
  });
  assert.throws(() => codec.parse(cipher, ["workspace-b", ...scope.slice(1)]));
  assert.throws(() =>
    new WorkflowStateCodec(randomBytes(32).toString("base64")).parse(
      cipher,
      scope,
    ),
  );
  const tampered = Buffer.from(cipher);
  tampered[20] = tampered[20]! ^ 1;
  assert.throws(() => codec.parse(tampered, scope));
  assert.throws(() => new WorkflowStateCodec("short"));
  assert.equal(JSON.stringify(codec), "{}");
});

test("staged rotation reads both generations, writes only the active key and rejects key/header substitution", () => {
  const old = randomBytes(32).toString("base64"),
    next = randomBytes(32).toString("base64"),
    identity = ["tenant", "user", "run", "input"];
  const legacy = new WorkflowStateCodec(old),
    oldCipher = legacy.json({ secret: "never log" }, identity);
  const staged = new WorkflowStateCodec({
    activeKeyId: "k2",
    keys: { k1: old, k2: next },
    legacyKey: old,
  });
  assert.deepEqual(staged.parse(oldCipher, identity), { secret: "never log" });
  const rotated = staged.reencrypt(oldCipher, identity);
  assert.equal(staged.keyId(rotated), "k2");
  const retired = new WorkflowStateCodec({
    activeKeyId: "k2",
    keys: { k2: next },
  });
  assert.deepEqual(retired.parse(rotated, identity), { secret: "never log" });
  assert.throws(() => retired.parse(oldCipher, identity));
  assert.throws(() => legacy.parse(rotated, identity));
  const tampered = Buffer.from(rotated);
  tampered[10] = tampered[10]! ^ 1;
  assert.throws(() => staged.parse(tampered, identity));
  assert.throws(
    () => new WorkflowStateCodec({ activeKeyId: "missing", keys: { k1: old } }),
  );
  assert.equal(JSON.stringify(staged), "{}");
});
