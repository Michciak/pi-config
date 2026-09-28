import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFileUnderWorkspace, resolveOutputUnderWorkspace, resolveWorkspace } from "../src/workspace.ts";

test("accepts real paths below the configured root", () => {
  const temp = mkdtempSync(join(tmpdir(), "pi-workspace-"));
  const root = join(temp, "root");
  const project = join(root, "project");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "README.md"), "ok");
  assert.equal(resolveWorkspace(root, project), realpathSync(project));
  assert.equal(resolveFileUnderWorkspace(root, join(project, "README.md")), realpathSync(join(project, "README.md")));
});

test("rejects traversal and symlinks that leave the configured root", () => {
  const temp = mkdtempSync(join(tmpdir(), "pi-workspace-"));
  const root = join(temp, "root");
  const outside = join(temp, "outside");
  mkdirSync(root); mkdirSync(outside);
  writeFileSync(join(outside, "secret.txt"), "no");
  symlinkSync(outside, join(root, "escape"));
  assert.throws(() => resolveWorkspace(root, outside), /outside/i);
  assert.throws(() => resolveWorkspace(root, join(root, "escape")), /outside/i);
  assert.throws(() => resolveFileUnderWorkspace(root, join(root, "escape", "secret.txt")), /outside/i);
});

test("allows new export files only below a canonical workspace parent", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-workspace-output-"));
  const nested = join(root, "nested");
  mkdirSync(nested);
  assert.equal(resolveOutputUnderWorkspace(root, join(nested, "session.html")), join(realpathSync(nested), "session.html"));
  assert.throws(() => resolveOutputUnderWorkspace(root, join(root, "..", "escape.html")), /outside/i);
});
