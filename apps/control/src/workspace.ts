import { realpathSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

export function resolveWorkspace(root: string, requested: string): string {
  const canonicalRoot = realpathSync(root);
  const candidate = realpathSync(resolve(requested));
  if (!statSync(candidate).isDirectory()) throw new Error("Workspace must be a directory");
  const rel = relative(canonicalRoot, candidate);
  if (rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"))) return candidate;
  throw new Error(`Workspace is outside the allowed root: ${canonicalRoot}`);
}

export function resolveFileUnderWorkspace(root: string, requested: string): string {
  const canonicalRoot = realpathSync(root);
  const candidate = realpathSync(resolve(requested));
  if (!statSync(candidate).isFile()) throw new Error("Path must be an existing file");
  const rel = relative(canonicalRoot, candidate);
  if (rel === "" || rel.startsWith("..") || rel.startsWith("/")) {
    throw new Error(`File is outside the allowed root: ${canonicalRoot}`);
  }
  return candidate;
}
