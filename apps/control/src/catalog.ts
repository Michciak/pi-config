import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export interface SubagentProfile {
  name: string;
  description?: string;
  tools: string[];
  skills: string[];
  subagents: string[];
  thinking?: string;
  source: "global" | "project";
}

function value(frontmatter: string, key: string): string | undefined {
  return frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim();
}

function list(raw?: string): string[] {
  return (raw ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function parseProfile(path: string, source: SubagentProfile["source"]): SubagentProfile | undefined {
  const raw = readFileSync(path, "utf8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return;
  const frontmatter = match[1]!;
  return {
    name: value(frontmatter, "name") ?? basename(path, ".md"),
    description: value(frontmatter, "description"),
    tools: list(value(frontmatter, "tools")),
    skills: list(value(frontmatter, "skill") ?? value(frontmatter, "skills")),
    subagents: list(value(frontmatter, "subagent_agents")),
    thinking: value(frontmatter, "thinking"),
    source,
  };
}

export function discoverSubagents(workspace: string, agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent")): SubagentProfile[] {
  const profiles = new Map<string, SubagentProfile>();
  const directories: Array<[string, SubagentProfile["source"]]> = [
    [join(agentDir, "agents"), "global"],
    [join(workspace, ".pi", "agents"), "project"],
  ];
  for (const [directory, source] of directories) {
    if (!existsSync(directory)) continue;
    for (const file of readdirSync(directory).filter((entry) => entry.endsWith(".md")).sort()) {
      try {
        const profile = parseProfile(join(directory, file), source);
        if (profile) profiles.set(profile.name, profile);
      } catch {
        // Match the Pi extension: one malformed or unreadable profile must not hide the rest.
      }
    }
  }
  return [...profiles.values()].sort((left, right) => left.name.localeCompare(right.name));
}
