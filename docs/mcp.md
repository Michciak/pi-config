# MCP

The repository contains a minimal stdio MCP server and Pi bridge:

- server: `extensions/mcp/server/index.mjs`
- bridge: `extensions/mcp/index.ts`
- tools: `mcp_config_status`, `mcp_provider_quota_status`

The server is spawned per call, so it has no persistent process or ambient project
state. It returns only curated configuration and normalized quota data; credentials
are read only to make provider requests and are never returned.

Smoke test:

```bash
cd extensions/mcp
node --input-type=module <<'EOF'
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const client = new Client({ name: 'smoke', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['server/index.mjs'] }));
console.log(await client.listTools());
await client.close();
EOF
```
