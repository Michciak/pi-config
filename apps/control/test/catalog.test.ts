import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSubagents } from "../src/catalog.js";

function profile(name: string, description: string, extra = ""): string {
  return `---\nname: ${name}\ndescription: ${description}\ntools: read, grep\nthinking: medium\n${extra}---\nPrompt`;
}

test("discovers profiles and lets a project profile override a global profile", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-catalog-"));
  const agentDir = join(root, "agent");
  const workspace = join(root, "workspace");
  mkdirSync(join(agentDir, "agents"), { recursive: true });
  mkdirSync(join(workspace, ".pi", "agents"), { recursive: true });
  writeFileSync(join(agentDir, "agents", "scout.md"), profile("scout", "Global scout"));
  writeFileSync(join(agentDir, "agents", "worker.md"), profile("worker", "Worker", "skills: web-debug\nsubagent_agents: scout, researcher\n"));
  writeFileSync(join(workspace, ".pi", "agents", "scout.md"), profile("scout", "Project scout"));
  writeFileSync(join(workspace, ".pi", "agents", "broken.md"), "missing frontmatter");

  const profiles = discoverSubagents(workspace, agentDir);
  assert.deepEqual(profiles.map((item) => item.name), ["scout", "worker"]);
  assert.equal(profiles[0]?.description, "Project scout");
  assert.equal(profiles[0]?.source, "project");
  assert.deepEqual(profiles[1]?.skills, ["web-debug"]);
  assert.deepEqual(profiles[1]?.subagents, ["scout", "researcher"]);
});
