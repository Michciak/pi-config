import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = new URL("./server/index.mjs", import.meta.url).pathname;

async function callMcp(name: string, args: Record<string, unknown>) {
  const client = new Client({ name: "pi-config-bridge", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath] });
  try {
    await client.connect(transport);
    return await client.callTool({ name, arguments: args });
  } finally {
    await client.close().catch(() => undefined);
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "mcp_provider_quota_status",
    label: "MCP Provider Quota",
    description: "Query configured provider/license quota without exposing credentials. Unknown is reported explicitly.",
    parameters: Type.Object({}),
    async execute() {
      const result = await callMcp("provider_quota_status", {});
      return { content: result.content as any, details: { transport: "stdio", server: "pi-config-local" } };
    },
  });

  pi.registerTool({
    name: "mcp_config_status",
    label: "MCP Config Status",
    description: "Call the local MCP server and return non-secret Pi configuration status.",
    parameters: Type.Object({}),
    async execute() {
      const result = await callMcp("config_status", {});
      return { content: result.content as any, details: { transport: "stdio", server: "pi-config-local" } };
    },
  });
}
