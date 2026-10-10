import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFileUnderWorkspace, resolveOutputUnderWorkspace, resolveWorkspace, listWorkspaceDirectories } from "../src/workspace.ts";

test("accepts real paths below the configured root", () => {
  const temp = mkdtempSync(join(tmpdir(), "pi-workspace-"));
  const root = join(temp, "root");
  const project = join(root, "project");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "README.md"), "ok");
  assert.equal(resolveWorkspace(root, project), realpathSync(project));
  assert.equal(resolveFileUnderWorkspace(root, join(project, "README.md")), realpathSync(join(project, "README.md")));
});

test("accepts any existing directory, keeping root only as the default", () => {
  const temp = mkdtempSync(join(tmpdir(), "pi-workspace-"));
  const root = join(temp, "root");
  const outside = join(temp, "outside");
  mkdirSync(root); mkdirSync(outside);
  writeFileSync(join(outside, "secret.txt"), "no");
  symlinkSync(outside, join(root, "escape"));
  assert.equal(resolveWorkspace(root, outside), realpathSync(outside));
  assert.equal(resolveWorkspace(root, join(root, "escape")), realpathSync(outside));
  assert.equal(resolveWorkspace(root, ""), realpathSync(root));
  assert.equal(resolveFileUnderWorkspace(root, join(root, "escape", "secret.txt")), realpathSync(join(outside, "secret.txt")));
});

test("rejects missing paths and non-directories", () => {
  const temp = mkdtempSync(join(tmpdir(), "pi-workspace-"));
  const root = join(temp, "root");
  mkdirSync(root);
  writeFileSync(join(root, "file.txt"), "no");
  assert.throws(() => resolveWorkspace(root, join(root, "missing")), /does not exist/i);
  assert.throws(() => resolveWorkspace(root, join(root, "file.txt")), /directory/i);
  assert.throws(() => resolveFileUnderWorkspace(root, join(root, "missing.txt")));
});

test("allows new export files below any existing directory parent", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-workspace-output-"));
  const nested = join(root, "nested");
  mkdirSync(nested);
  assert.equal(resolveOutputUnderWorkspace(root, join(nested, "session.html")), join(realpathSync(nested), "session.html"));
  assert.throws(() => resolveOutputUnderWorkspace(root, join(root, "missing-dir", "escape.html")), /does not exist/i);
});

test("directory browser lists folders anywhere and resolves symlinks", () => {
  const temp = mkdtempSync(join(tmpdir(), "pi-browser-"));
  const root = join(temp, "root");
  mkdirSync(root); mkdirSync(join(root, "project")); mkdirSync(join(temp, "outside"));
  writeFileSync(join(root, "file.txt"), "test");
  symlinkSync(join(temp, "outside"), join(root, "escape"));
  const listing = listWorkspaceDirectories(root, root);
  assert.equal(listing.parent, realpathSync(temp));
  assert.deepEqual(listing.directories.map(item => item.name), ["escape", "project"]);
  assert.equal(listWorkspaceDirectories(root, join(root, "project")).parent, realpathSync(root));
  assert.equal(listWorkspaceDirectories(root, join(temp, "outside")).path, realpathSync(join(temp, "outside")));
  assert.equal(listWorkspaceDirectories(root, join(root, "escape")).path, realpathSync(join(temp, "outside")));
});
