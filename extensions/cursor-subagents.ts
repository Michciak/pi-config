import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ROLES = ["coder", "detective", "fixer", "inventor", "planner", "reviewer"] as const;
type Role = (typeof ROLES)[number];

function promptFor(role: Role, cwd: string): string {
  const paths = [join(cwd, ".pi", "agents", role + ".md"), join(homedir(), ".pi", "agent", "agents", role + ".md")];
  const path = paths.find(existsSync);
  if (!path) throw new Error("Missing Pi subagent prompt; checked " + paths.join(" and "));
  return readFileSync(path, "utf8");
}

async function run(pi: ExtensionAPI, role: Role, task: string, cwd: string, signal?: AbortSignal, model?: string) {
  const prompt = [promptFor(role, cwd), "\n\n## Delegated task\n", task, "\n\nYou are a delegated read-only consultant. Inspect and report findings, plans, or review comments. Do not modify files, commit, merge, or send messages. The parent Pi session owns changes and verification."].join("");
  const args = ["-p", "--mode", "ask", "--output-format", "text", "--workspace", cwd];
  if (model) args.push("--model", model);
  args.push("--", prompt);
  const result = await pi.exec("agent", args, { cwd, signal, timeout: 180000 });
  if (result.killed) throw new Error("Cursor subagent was cancelled or exceeded 180 seconds.");
  if (result.code !== 0) throw new Error("Cursor " + role + " failed (" + result.code + "): " + (result.stderr || result.stdout).slice(0, 4000));
  const text = result.stdout.trim() || "Cursor subagent returned no text.";
  return text.length > 30000 ? text.slice(0, 30000) + "\n[Output truncated to 30000 characters]" : text;
}

export default function (pi: ExtensionAPI) {
  for (const role of ROLES) {
    pi.registerTool(defineTool({
      name: "cursor_" + role,
      label: "Cursor " + role,
      description: "Delegate a read-only task to the Cursor " + role + " subagent. Its role prompt is copied from ~/.cursor/agents/" + role + ".md. It may inspect the current workspace with Cursor tools; it must return advice to the parent Pi session, which remains responsible for changes and verification.",
      parameters: Type.Object({
        task: Type.String({ description: "A self-contained task with relevant context and a concrete requested output", minLength: 1 }),
        model: Type.Optional(Type.String({ description: "Optional exact Cursor model ID" })),
      }),
      async execute(_id, params, signal, _update, ctx) {
        return { content: [{ type: "text", text: await run(pi, role, params.task, ctx.cwd, signal, params.model) }], details: { provider: "cursor", role, mode: "ask" } };
      },
    }));
  }
}
