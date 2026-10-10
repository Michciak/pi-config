import { chmodSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// node-pty's npm prebuild can lose its executable bit during extraction on macOS.
export function preparePtyHelper(): void {
  if (process.platform !== "darwin") return;
  const root = dirname(dirname(createRequire(import.meta.url).resolve("node-pty")));
  for (const relative of [`prebuilds/darwin-${process.arch}/spawn-helper`, "build/Release/spawn-helper"]) {
    const path = join(root, relative);
    if (existsSync(path)) chmodSync(path, 0o755);
  }
}
