import { existsSync, realpathSync, statSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

function requestedPath(root: string, requested: string): string {
  if (requested.startsWith("~/")) return join(homedir(), requested.slice(2));
  return isAbsolute(requested) ? requested : resolve(root, requested);
}

function existingDirectory(path: string): string {
  let candidate: string;
  try { candidate = realpathSync(path); }
  catch { throw new Error(`Directory does not exist: ${path}`); }
  if (!statSync(candidate).isDirectory()) throw new Error("Workspace must be a directory");
  return candidate;
}

// `root` stays the default session directory, but any other existing directory
// on the Mac is accepted as a session workspace.
export function resolveWorkspace(root: string, requested: string): string {
  if (!requested.trim()) return realpathSync(root);
  return existingDirectory(requestedPath(root, requested));
}

export function resolveFileUnderWorkspace(root: string, requested: string): string {
  const candidate = realpathSync(requestedPath(root, requested));
  if (!statSync(candidate).isFile()) throw new Error("Path must be an existing file");
  return candidate;
}

export function resolveOutputUnderWorkspace(root: string, requested: string): string {
  if (!requested.trim()) throw new Error("Output path is required");
  if (existsSync(requestedPath(root, requested))) return resolveFileUnderWorkspace(root, requested);
  const parent = existingDirectory(dirname(requestedPath(root, requested)));
  return join(parent, basename(requestedPath(root, requested)));
}

export function listWorkspaceDirectories(root: string, requested = root) {
  const path = resolveWorkspace(root, requested);
  const directories = readdirSync(path, { withFileTypes: true }).filter(entry => !entry.name.startsWith(".")).flatMap(entry => {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) return [];
    try { return [{ name: entry.name, path: existingDirectory(join(path, entry.name)) }]; }
    catch { return []; }
  }).sort((a, b) => a.name.localeCompare(b.name));
  const parent = dirname(path);
  return { path, parent: parent === path ? null : parent, directories };
}
