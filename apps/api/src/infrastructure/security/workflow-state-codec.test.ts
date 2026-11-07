import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { WorkflowStateCodec } from "./workflow-state-codec.js";
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
