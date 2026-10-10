import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, realpathSync, lstatSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { insideWorkspace } from "./cockpit-workspace.js";
import type { PluginManifest } from "@pi-local/protocol";

const AGENT_DIR = join(homedir(), ".pi", "agent");

function readJson(path: string, fallback: any = {}) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

export function extensionInventory() {
  const settings = readJson(join(AGENT_DIR, "settings.json"), {});
  const packages: string[] = Array.isArray(settings.packages) ? settings.packages.map(String) : [];
  return packages.map((source) => {
    const name = source.replace(/^npm:/, "");
    const path = join(AGENT_DIR, "npm", "node_modules", ...name.split("/"));
    const manifest = readJson(join(path, "package.json"), {});
    return { source, name: manifest.name || name, version: manifest.version || "unknown", description: manifest.description || "", extensions: manifest.pi?.extensions || [], skills: manifest.pi?.skills || [] };
  });
}

export function extensionConfig(name: string) {
  const specs: Record<string, { path: string; defaults: unknown }> = {
    "@juicesharp/rpiv-todo": { path: join(homedir(), ".config", "rpiv-todo", "config.json"), defaults: { maxWidgetLines: 12, collapseKey: "ctrl+shift+t" } },
    "@schovest/pi-goal": { path: join(AGENT_DIR, "pi-goal.json"), defaults: { toolVisibility: "after-first-goal", rpc: { enabled: false }, continuationLimits: { automaticTurns: 25, noProgressTurns: 3 } } },
    "@quintinshaw/pi-dynamic-workflows": { path: join(homedir(), ".pi", "workflows", "settings.json"), defaults: { defaultEffort: "off", persistAgentSessions: false } },
  };
  const spec = specs[name];
  if (!spec) return { name, editable: false, config: {}, defaults: {} };
  return { name, editable: true, path: spec.path, config: readJson(spec.path, {}), defaults: spec.defaults };
}

export function saveExtensionConfig(name: string, patch: Record<string, unknown>) {
  const current = extensionConfig(name);
  if (!current.editable || !current.path) throw Object.assign(new Error("Extension config is not editable"), { statusCode: 400 });
  if (!patch || typeof patch!=="object" || Array.isArray(patch)) throw Object.assign(new Error("Config must be an object"),{statusCode:400});
  const raw=existsSync(current.path)?JSON.parse(readFileSync(current.path,"utf8")):{};
  const merged = deepMerge(raw, patch);
  if (name === "@schovest/pi-goal") {
    for (const key of ["automaticTurns","noProgressTurns"]) {
      const value=merged.continuationLimits?.[key];
      if (value!==undefined && (!Number.isSafeInteger(value)||value<1||value>(key==="automaticTurns"?25:3))) throw Object.assign(new Error("Goal continuation limits must stay within 25 automatic and 3 no-progress turns"),{statusCode:400});
    }
  }
  mkdirSync(dirname(current.path), { recursive: true, mode: 0o700 });
  const temp = `${current.path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(merged, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(temp, current.path);
  } finally { rmSync(temp, { force: true }); }
  return { ...current, config: merged };
}

function deepMerge(target: any, patch: any): any {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const result = target && typeof target === "object" && !Array.isArray(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) throw Object.assign(new Error("Invalid config key"), { statusCode: 400 });
    result[key] = value && typeof value === "object" && !Array.isArray(value) ? deepMerge(result[key], value) : value;
  }
  return result;
}

export class PluginStore {
  private backupClock = Date.now();
  private backupPath(id:string) { this.backupClock=Math.max(Date.now(),this.backupClock+1); return join(this.backups,`${id}-${this.backupClock}-${randomUUID()}`); }
  readonly root: string;
  readonly backups: string;
  constructor(runtimeDir: string) { this.root = join(runtimeDir, "plugins"); this.backups = join(runtimeDir, "plugin-backups"); mkdirSync(this.root, { recursive: true, mode: 0o700 }); mkdirSync(this.backups, { recursive: true, mode: 0o700 }); }

  list(): PluginManifest[] {
    return readdirSync(this.root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
      try { return [this.readManifest(join(this.root, entry.name))]; } catch { return []; }
    });
  }

  inspect(source: string) {
    const path = realpathSync(source);
    const manifest = this.readManifest(path);
    let bytes = 0;
    const hash = createHash("sha256");
    const walk = (dir: string) => {
      for (const name of readdirSync(dir).sort()) {
        const file = join(dir, name);
        const stat = lstatSync(file);
        if (stat.isSymbolicLink()) throw Object.assign(new Error("Plugin symlinks are not supported"), { statusCode: 400 });
        if (stat.isDirectory()) walk(file);
        else {
          bytes += stat.size;
          if (bytes > 100 * 1024 * 1024) throw Object.assign(new Error("Plugin exceeds 100 MiB"), { statusCode: 413 });
          hash.update(file.slice(path.length)); hash.update(readFileSync(file));
        }
      }
    };
    walk(path);
    return { source: path, manifest, digest: hash.digest("hex") };
  }

  install(source: string, digest?: string): PluginManifest {
    const preview = this.inspect(source);
    if (digest && digest !== preview.digest) throw Object.assign(new Error("Plugin source changed; review it again"), { statusCode: 409 });
    const path = preview.source;
    if (!statSync(path).isDirectory()) throw Object.assign(new Error("Plugin source must be a local directory"), { statusCode: 400 });
    const manifest = preview.manifest;
    const target = join(this.root, manifest.id);
    const staging = join(this.root, `_staging_${randomUUID()}`);
    let backup: string | undefined;
    if (path === target || path.startsWith(this.root + "/") || path.startsWith(this.backups + "/")) throw new Error("Choose an external plugin source");
    cpSync(path, staging, { recursive: true, errorOnExist: true });
    if (existsSync(target)) {
      for(const name of ["config.json","storage.json","secrets.bin","schedules.json"]){
        const saved=join(target,name);
        if(existsSync(saved))cpSync(saved,join(staging,name));
      }
      backup = this.backupPath(manifest.id);
      renameSync(target, backup);
    }
    try { renameSync(staging, target); }
    catch (error) { rmSync(staging, { recursive: true, force: true }); if (backup) renameSync(backup, target); throw error; }
    return this.readManifest(target);
  }

  rollback(id: string): PluginManifest {
    this.directory(id);
    const latest = readdirSync(this.backups).filter(name => name.startsWith(id + "-")).sort().at(-1);
    if (!latest) throw Object.assign(new Error("No rollback available"), { statusCode: 404 });
    const target = join(this.root, id), saved = join(this.backups, latest);
    const displaced = this.backupPath(id);
    if (existsSync(target)) renameSync(target, displaced);
    try { renameSync(saved, target); } catch (error) { if (existsSync(displaced)) renameSync(displaced, target); throw error; }
    return this.readManifest(target);
  }
  directory(id: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw Object.assign(new Error("Invalid plugin id"), { statusCode: 400 });
    return join(this.root, id);
  }
  asset(id: string, path: string): string { return insideWorkspace(this.directory(id), path); }
  manifest(id: string): PluginManifest { return this.readManifest(this.directory(id)); }
  remove(id: string): void { const dir = this.directory(id); if (existsSync(dir)) renameSync(dir, this.backupPath(id)); }

  private readManifest(dir: string): PluginManifest {
    const raw = readJson(join(dir, "manifest.json"), null);
    const id = raw?.id ?? basename(dir);
    if (!raw || !/^[a-zA-Z0-9_-]+$/.test(id) || typeof raw.name !== "string" || !Array.isArray(raw.permissions) || raw.permissions.some((p: unknown) => typeof p !== "string")) throw Object.assign(new Error(`Invalid plugin manifest in ${basename(dir)}; explicit permissions required`), { statusCode: 400 });
    const client = typeof raw.client === "string" ? raw.client : existsSync(join(dir, "client/entry.mjs")) ? "client/entry.mjs" : undefined;
    const server = typeof raw.server === "string" ? raw.server : existsSync(join(dir, "index.mjs")) ? "index.mjs" : undefined;
    if (client) insideWorkspace(dir, client);
    if (server) insideWorkspace(dir, server);
    return { ...raw, id, name: raw.name, version: raw.version ?? "0.0.0", description: typeof raw.description === "string" ? raw.description : undefined, permissions: raw.permissions, client, server, enabled: raw.enabled !== false };
  }
}
