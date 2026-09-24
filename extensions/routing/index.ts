import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";

const scopeFile = `${process.env.HOME}/.pi/agent/settings.json`;
const capabilityFile = new URL("../../settings/model-capabilities.json", import.meta.url);

export default function (pi: ExtensionAPI) {
  pi.registerCommand("route-model", {
    description: "Select a model from the curated scope using task JSON",
    handler: async (args, ctx) => {
      const task = args.trim() ? JSON.parse(args) : {};
      const settings = JSON.parse(await readFile(scopeFile, "utf8"));
      const capabilities = JSON.parse(await readFile(capabilityFile, "utf8"));
      const scope = new Set<string>(settings.enabledModels ?? []);
      const candidates = Object.entries(capabilities as Record<string, any>)
        .filter(([id, meta]) => scope.has(id) && meta.enabled && meta.verified)
        .filter(([, meta]) => meta.local || task.taskClass === "simple")
        .filter(([, meta]) => !task.localOnly || meta.local)
        .filter(([, meta]) => !task.role || meta.roles.includes(task.role))
        .filter(([, meta]) => !task.vision || meta.vision)
        .sort(([, a], [, b]) => (b.priority ?? 0) - (a.priority ?? 0));
      const selected = candidates[0]?.[0];
      ctx.ui.notify(selected ? `Selected: ${selected}` : "No eligible scoped model", selected ? "info" : "warning");
    },
  });
}
