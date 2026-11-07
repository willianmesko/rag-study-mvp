import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mcpReadToolNames } from "@rag-study/contracts";

// No provider/API call is needed to initialize and inspect the actual image.
const client = new Client({ name: "lumora-image-verification", version: "1.0.0" }, { versionNegotiation: { mode: "legacy" } });
const transport = new StdioClientTransport({
  command: "docker",
  args: ["run", "--rm", "-i", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
    "-e", "LUMORA_MCP_API_URL=http://127.0.0.1:1",
    "-e", "LUMORA_MCP_TOKEN=lumora_mcp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "-e", "LUMORA_MCP_WORKSPACE_ID=11111111-1111-4111-8111-111111111111", "lumora-mcp:ci"],
});
let timer;
try {
  await Promise.race([
    (async () => {
      await client.connect(transport);
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map(({ name }) => name).sort(), [...mcpReadToolNames].sort());
      assert.ok(tools.every((tool) => tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint === false && tool.inputSchema.additionalProperties === false));
      await assert.rejects(client.callTool({ name: "run_evaluation", arguments: {} }));
      console.log(JSON.stringify({ kind: "lumora.mcp-image", tools: tools.length, readOnly: true, network: "disabled", writeToolRejected: true }));
    })(),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("MCP image verification timed out.")), 15_000); }),
  ]);
} finally {
  clearTimeout(timer);
  await client.close();
}
