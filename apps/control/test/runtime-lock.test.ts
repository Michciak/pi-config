import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquireRuntimeLock } from "../src/runtime-lock.ts";

test("runtime lease excludes a second server and permits a clean restart", async () => {
  const runtime = mkdtempSync(join(tmpdir(), "pi-runtime-lock-"));
  const release = await acquireRuntimeLock(runtime);
  try { await assert.rejects(acquireRuntimeLock(runtime), { code: "ELOCKED" }); }
  finally { await release(); }
  const restartRelease = await acquireRuntimeLock(runtime);
  await restartRelease();
});
