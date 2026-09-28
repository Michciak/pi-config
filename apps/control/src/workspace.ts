import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

function requestedPath(root: string, requested: string): string {
  if (requested.startsWith("~/")) return join(homedir(), requested.slice(2));
  return isAbsolute(requested) ? requested : resolve(root, requested);
}

export function resolveWorkspace(root: string, requested: string): string {
  const canonicalRoot = realpathSync(root);
  const candidate = realpathSync(requestedPath(canonicalRoot, requested));
  if (!statSync(candidate).isDirectory()) throw new Error("Workspace must be a directory");
  const rel = relative(canonicalRoot, candidate);
  if (rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"))) return candidate;
  throw new Error(`Workspace is outside the allowed root: ${canonicalRoot}`);
}

export function resolveFileUnderWorkspace(root: string, requested: string): string {
  const canonicalRoot = realpathSync(root);
  const candidate = realpathSync(requestedPath(canonicalRoot, requested));
  if (!statSync(candidate).isFile()) throw new Error("Path must be an existing file");
  const rel = relative(canonicalRoot, candidate);
  if (rel === "" || rel.startsWith("..") || rel.startsWith("/")) {
    throw new Error(`File is outside the allowed root: ${canonicalRoot}`);
  }
  return candidate;
}

export function resolveOutputUnderWorkspace(root: string, requested: string): string {
  if (!requested.trim()) throw new Error("Output path is required");
  if (existsSync(requestedPath(root, requested))) return resolveFileUnderWorkspace(root, requested);
  const canonicalRoot = realpathSync(root);
  const raw = requestedPath(canonicalRoot, requested);
  const parent = realpathSync(dirname(raw));
  const rel = relative(canonicalRoot, parent);
  if (rel.startsWith("..") || rel.startsWith("/")) throw new Error(`Output is outside the allowed root: ${canonicalRoot}`);
  return join(parent, basename(raw));
}
