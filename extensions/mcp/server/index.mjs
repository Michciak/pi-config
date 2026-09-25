import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "node:fs/promises";
import { checkQuotas } from "../../../scripts/quota-check.mjs";

const server = new McpServer({ name: "pi-config-local", version: "1.0.0" });
server.registerTool("config_status", {
  description: "Return non-secret local Pi configuration health.",
  inputSchema: {},
}, async () => {
  const settings = JSON.parse(await fs.readFile(`${process.env.HOME}/.pi/agent/settings.json`, "utf8"));
  return { content: [{ type: "text", text: JSON.stringify({
    defaultProvider: settings.defaultProvider,
    defaultModel: settings.defaultModel,
    enabledModels: settings.enabledModels,
    secrets: "not inspected",
  }, null, 2) }] };
});

server.registerTool("provider_quota_status", {
  description: "Report quota status for configured OpenRouter and OpenAI/Codex licenses without exposing credentials.",
  inputSchema: {},
}, async () => ({ content: [{ type: "text", text: JSON.stringify(await checkQuotas(), null, 2) }] }));

const transport = new StdioServerTransport();
await server.connect(transport);
