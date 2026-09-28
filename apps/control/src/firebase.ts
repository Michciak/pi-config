import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { StateStore } from "./store.js";

const execFileAsync = promisify(execFile);

export class FirebaseNotifier {
  private app?: App;
  private state: "enabled" | "disabled" | "error" = "disabled";
  constructor(private readonly store: StateStore, private readonly keychainService: string) {}

  async initialize(): Promise<void> {
    try {
      const { stdout } = await execFileAsync("/usr/bin/security", [
        "find-generic-password", "-s", this.keychainService, "-w",
      ], { encoding: "utf8", maxBuffer: 1024 * 1024 });
      const serviceAccount = JSON.parse(stdout.trim());
      this.app = getApps().find((item) => item.name === "pi-web") ?? initializeApp({
        credential: cert(serviceAccount),
        projectId: serviceAccount.project_id,
      }, "pi-web");
      this.state = "enabled";
    } catch (error: any) {
      const message = String(error?.message ?? error);
      this.state = /could not be found|The specified item/i.test(message) ? "disabled" : "error";
    }
  }

  status(): "enabled" | "disabled" | "error" { return this.state; }

  async send(eventId: string): Promise<void> {
    if (!this.app || this.state !== "enabled") return;
    const tokens = this.store.devices().map((row) => row.fcm_token).filter((value): value is string => !!value);
    if (tokens.length === 0) return;
    try {
      const result = await getMessaging(this.app).sendEachForMulticast({
        tokens,
        data: { eventId },
        android: { priority: "high" },
      });
      result.responses.forEach((response, index) => {
        if (!response.success && /registration-token-not-registered|invalid-registration-token/i.test(response.error?.code ?? "")) {
          const token = tokens[index];
          if (token) this.store.db.prepare("UPDATE devices SET fcm_token=NULL WHERE fcm_token=?").run(token);
        }
      });
    } catch {
      this.state = "error";
    }
  }
}
