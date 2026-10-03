import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { routeLive } from "../../scripts/route-model.mjs";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("route-model", {
    description: "Select a model from the curated scope using live health/quota state",
    handler: async (args, ctx) => {
      try {
        const input = args.trim() ? JSON.parse(args) : {};
        const task = input.task ?? input;
        const result = await routeLive(task);
        const state = result.runtime[result.selected] ?? result.runtime[result.selected.split("/", 1)[0]] ?? {};
        ctx.ui.notify(
          `Selected: ${result.selected}\nAttempts: ${result.attempts.join(", ")}\n` +
          `Health: ${state.healthy ?? "unknown"}; quota: ${state.quotaKnown ? state.quotaRemaining : "unknown"}`,
          "info",
        );
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
