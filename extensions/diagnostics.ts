import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const localChecks = [
  ["Qwen endpoint", "http://127.0.0.1:8081/v1/models"],
  ["GLM endpoint", "http://127.0.0.1:8080/v1/models"],
] as const;

async function endpoint(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return `${response.status} ${response.statusText}`;
  } catch (error) {
    return `unavailable (${error instanceof Error ? error.message : "error"})`;
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("config-health", {
    description: "Check Pi configuration and provider health without exposing secrets",
    handler: async (_args, ctx) => {
      const lines: string[] = [];
      try {
        const models = JSON.parse(await readFile(new URL("settings/models.json", root), "utf8"));
        lines.push(`models.json: readable (${Object.keys(models.providers ?? {}).join(", ")})`);
      } catch {
        lines.push("models.json: ERROR");
      }
      try {
        const capabilities = JSON.parse(await readFile(new URL("settings/model-capabilities.json", root), "utf8"));
        lines.push(`capabilities: ${Object.keys(capabilities).length} scoped entries`);
      } catch {
        lines.push("capabilities: ERROR");
      }
      lines.push("OpenRouter auth: configured in Pi runtime (secret not inspected)");
      for (const [name, url] of localChecks) lines.push(`${name}: ${await endpoint(url)}`);
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
