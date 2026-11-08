import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type Socket } from "node:net";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

test("the migration CLI closes a rejected checkout and never prints PostgreSQL private details", { timeout: 15_000 }, async (t) => {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket); socket.once("close", () => sockets.delete(socket));
    socket.once("data", () => {
      const fields = Buffer.from("SFATAL\0C28P01\0MPRIVATE_CREDENTIAL_SENTINEL\0DPRIVATE_DOCUMENT_SENTINEL\0\0");
      const packet = Buffer.alloc(fields.length + 5); packet[0] = 69;
      packet.writeInt32BE(fields.length + 4, 1); fields.copy(packet, 5); socket.end(packet);
    });
  });
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address === "object");
  const result = await new Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./migrate.ts", import.meta.url))], {
      env: { PATH: process.env.PATH, DATABASE_URL: `postgresql://PRIVATE_CONNECTION_SENTINEL@127.0.0.1:${address.port}/fixture` },
      timeout: 10_000, maxBuffer: 1024 * 1024
    }, (error, stdout, stderr) => resolve({ code: error ? typeof error.code === "number" ? error.code : null : 0,
      signal: error?.signal ?? null, stdout, stderr }));
  });
  assert.equal(result.code, 1); assert.equal(result.signal, null);
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_|Migration failed:|password authentication/);
  const diagnostic = result.stderr.trim().split("\n").find((line) => line.startsWith("{"));
  assert.ok(diagnostic);
  assert.deepEqual(JSON.parse(diagnostic), { event: "database_migration_failed", reason: "migration_failed", sqlState: "28P01" });
});
