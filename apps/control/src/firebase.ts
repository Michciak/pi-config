import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getMessaging, type BatchResponse, type MulticastMessage } from "firebase-admin/messaging";
import { StateStore } from "./store.js";
import { notificationCategory, notificationDefaults, type NotificationPreferences } from "./notification-policy.js";

const execFileAsync = promisify(execFile);

export interface NotificationDelivery {
  eventId: string;
  attemptedAt: string;
  attempted: boolean;
  successCount: number;
  failureCount: number;
  error?: string;
  skipped?: string;
}

export interface NotificationDiagnostics {
  state: "enabled" | "disabled" | "error";
  pairedDevices: number;
  registeredDevices: number;
  lastDelivery?: NotificationDelivery;
  preferences: NotificationPreferences;
}

export class FirebaseNotifier {
  private app?: App;
  private state: "enabled" | "disabled" | "error" = "disabled";
  private lastDelivery?: NotificationDelivery;
  private foreground = new Map<string, number>();
  setForegroundClient(id: string, active: boolean): void { if(active)this.foreground.set(id,Date.now());else this.foreground.delete(id); }
  constructor(private readonly store: StateStore, private readonly keychainService: string,
    private readonly transport?: (message: MulticastMessage) => Promise<BatchResponse>) {}

  preferences(): NotificationPreferences {
    const row = this.store.db.prepare("SELECT value FROM metadata WHERE key='phone_notifications'").get() as any;
    let saved: any = {}; try { saved = JSON.parse(row?.value ?? "{}"); } catch {}
    return Object.fromEntries(Object.entries(notificationDefaults).map(([key, value]) => [key, typeof saved[key] === "boolean" ? saved[key] : value])) as NotificationPreferences;
  }
  savePreferences(input: unknown): NotificationPreferences {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !Object.hasOwn(notificationDefaults,key) || typeof (input as any)[key] !== "boolean"))
      throw Object.assign(new Error("Invalid notification preferences"), { statusCode: 400 });
    const next = { ...this.preferences(), ...input };
    this.store.db.prepare("INSERT INTO metadata(key,value) VALUES('phone_notifications',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(next));
    return next;
  }

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
      preferences: this.preferences(),
    };
  }

  async send(eventId: string): Promise<NotificationDelivery> {
    const attemptedAt = new Date().toISOString();
    const event = this.store.event(Number(eventId));
    const category = event && notificationCategory(event);
    if (category && !this.preferences()[category]) return this.remember({eventId,attemptedAt,attempted:false,successCount:0,failureCount:0,skipped:"disabled-by-preference"});
    // A foreground browser must not silence the paired phone's decision alerts.
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
      const result = await (this.transport ?? ((message) => getMessaging(this.app).sendEachForMulticast(message)))({
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
