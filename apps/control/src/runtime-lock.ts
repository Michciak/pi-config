import { join } from "node:path";
import lockfile from "proper-lockfile";

/** Atomic OS-visible lease, acquired before touching SQLite or the Unix socket. */
export async function acquireRuntimeLock(runtimeDir: string): Promise<() => Promise<void>> {
  return lockfile.lock(runtimeDir, {
    lockfilePath: join(runtimeDir, "control.lock"),
    stale: 10_000,
    update: 2_000,
    retries: 0,
    onCompromised: (error) => {
      console.error("Control Service runtime lease lost; stopping to prevent concurrent writers", error);
      process.exit(1);
    },
  });
}
