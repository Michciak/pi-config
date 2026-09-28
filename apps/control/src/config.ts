import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export interface ControlConfig {
  host: string;
  port: number;
  runtimeDir: string;
  databasePath: string;
  socketPath: string;
  sessionsDir: string;
  workspaceRoot: string;
  webAssets: string;
  firebaseKeychainService: string;
  snippetsDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ControlConfig {
  const runtimeDir = resolve(env.PI_WEB_RUNTIME_DIR ?? join(homedir(), ".pi", "agent", "web-control"));
  const workspaceRoot = resolve(
    env.PI_WEB_WORKSPACE_ROOT ?? join(homedir(), "Library", "CloudStorage", "Dropbox", "NETRIX"),
  );
  const webAssets = resolve(env.PI_WEB_ASSETS ?? join(here, "..", "..", "web", "dist"));
  const config: ControlConfig = {
    host: env.PI_WEB_HOST ?? "0.0.0.0",
    port: Number.parseInt(env.PI_WEB_PORT ?? "3784", 10),
    runtimeDir,
    databasePath: join(runtimeDir, "state.sqlite"),
    socketPath: join(runtimeDir, "interactions.sock"),
    sessionsDir: join(runtimeDir, "sessions"),
    workspaceRoot,
    webAssets,
    firebaseKeychainService: env.PI_WEB_FIREBASE_KEYCHAIN_SERVICE ?? "pi-web.firebase-admin",
    snippetsDir: resolve(env.PI_WEB_SNIPPETS_DIR ?? join(homedir(), ".pi", "agent", "extensions", "prompt-snippets", "snippets")),
  };
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error(`Invalid PI_WEB_PORT: ${env.PI_WEB_PORT}`);
  }
  return config;
}

export function ensureRuntimeDirectories(config: ControlConfig): void {
  mkdirSync(config.runtimeDir, { recursive: true, mode: 0o700 });
  mkdirSync(config.sessionsDir, { recursive: true, mode: 0o700 });
  if (!existsSync(config.workspaceRoot)) {
    throw new Error(`Configured workspace root does not exist: ${config.workspaceRoot}`);
  }
}
