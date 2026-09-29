import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { StateStore } from "./store.js";

const execFileAsync = promisify(execFile);

export interface NotificationDelivery {
  eventId: string;
  attemptedAt: string;
  attempted: boolean;
  successCount: number;
  failureCount: number;
  error?: string;
}

export interface NotificationDiagnostics {
  state: "enabled" | "disabled" | "error";
  pairedDevices: number;
  registeredDevices: number;
  lastDelivery?: NotificationDelivery;
}

export class FirebaseNotifier {
  private app?: App;
  private state: "enabled" | "disabled" | "error" = "disabled";
  private lastDelivery?: NotificationDelivery;
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

  diagnostics(): NotificationDiagnostics {
    const devices = this.store.devices();
    return {
      state: this.state,
      pairedDevices: devices.length,
      registeredDevices: devices.filter((row) => !!row.fcm_token).length,
      lastDelivery: this.lastDelivery,
    };
  }

  async send(eventId: string): Promise<NotificationDelivery> {
    const attemptedAt = new Date().toISOString();
    if (!this.app || this.state !== "enabled") {
      return this.remember({ eventId, attemptedAt, attempted: false, successCount: 0, failureCount: 0,
        error: this.state === "disabled" ? "Firebase Admin is not configured" : "Firebase Admin initialization failed" });
    }
    const tokens = this.store.devices().map((row) => row.fcm_token).filter((value): value is string => !!value);
    if (tokens.length === 0) {
      return this.remember({ eventId, attemptedAt, attempted: false, successCount: 0, failureCount: 0,
        error: "No paired device has an FCM token" });
    }
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
      const errorCodes = result.responses
        .filter((response) => !response.success)
        .map((response) => response.error?.code)
        .filter((code): code is string => !!code);
      return this.remember({
        eventId, attemptedAt, attempted: true,
        successCount: result.successCount, failureCount: result.failureCount,
        error: errorCodes.length > 0 ? [...new Set(errorCodes)].join(", ") : undefined,
      });
    } catch (error: any) {
      return this.remember({
        eventId, attemptedAt, attempted: true, successCount: 0, failureCount: tokens.length,
        error: String(error?.code ?? "FCM delivery failed").slice(0, 120),
      });
    }
  }

  private remember(delivery: NotificationDelivery): NotificationDelivery {
    this.lastDelivery = delivery;
    return delivery;
  }
}
