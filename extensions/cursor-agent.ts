import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const executable = join(homedir(), ".local/bin/agent");
  async function run(prompt: string, cwd: string, signal?: AbortSignal, model?: string) {
    const args = ["-p", "--mode", "ask", "--output-format", "text", "--workspace", cwd];
    if (model) args.push("--model", model);
    args.push("--", prompt);
    const result = await pi.exec(executable, args, { cwd, signal, timeout: 120000 });
    if (result.killed) throw new Error("Cursor stopped: cancelled or exceeded 120 seconds.");
    if (result.code !== 0) throw new Error(`Cursor failed (${result.code}): ${(result.stderr || result.stdout).slice(0, 4000)}`);
    const text = result.stdout.trim() || "Cursor returned no text.";
    return text.length > 24000 ? text.slice(0, 24000) + "\n[Output truncated to 24000 characters]" : text;
  }
  pi.registerTool(defineTool({
    name: "cursor_agent",
    label: "Cursor review",
    description: "Ask Cursor CLI for read-only analysis or a second opinion in the current project. Send a self-contained task. Uses the user's Cursor authentication and settings. Does not enable force, trust, or automatic MCP approval. Cursor usage is billed separately and is not included in Pi token totals.",
    parameters: Type.Object({
      prompt: Type.String({ description: "Self-contained analysis task", minLength: 1 }),
      model: Type.Optional(Type.String({ description: "Optional exact model ID from agent models" })),
    }),
    async execute(_id, params, signal, _update, ctx) {
      return { content: [{ type: "text", text: await run(params.prompt, ctx.cwd, signal, params.model) }], details: { mode: "ask", provider: "cursor" } };
    },
  }));
  pi.registerCommand("cursor", {
    description: "Read-only Cursor analysis: /cursor <task>",
    handler: async (args, ctx) => {
      if (!args.trim()) { ctx.ui.notify("Usage: /cursor <task>", "info"); return; }
      try {
        const text = await run(args, ctx.cwd, ctx.signal);
        pi.sendMessage({ customType: "cursor-review", content: text, display: true }, { triggerTurn: false });
      } catch (error) { ctx.ui.notify(String(error), "error"); }
    },
  });
}
