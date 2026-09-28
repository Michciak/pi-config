import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { StateStore } from "./store.js";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

export function isLoopback(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

export function randomToken(bytes = 32): string { return randomBytes(bytes).toString("base64url"); }

export function verifyDeviceRequest(store: StateStore, request: FastifyRequest): boolean {
  const deviceId = String(request.headers["x-pi-device"] ?? "");
  const timestampText = String(request.headers["x-pi-timestamp"] ?? "");
  const nonce = String(request.headers["x-pi-nonce"] ?? "");
  const signatureText = String(request.headers["x-pi-signature"] ?? "");
  if (!deviceId || !timestampText || !nonce || !signatureText) return false;
  const timestamp = Number(timestampText);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60_000) return false;
  const device = store.device(deviceId);
  if (!device || store.hasNonce(deviceId, nonce)) return false;
  const path = request.url.split("?")[0] ?? request.url;
  const bodyHash = createHash("sha256").update(request.body === undefined ? "" : canonicalJson(request.body)).digest("hex");
  const canonical = `${timestampText}\n${nonce}\n${request.method.toUpperCase()}\n${path}\n${bodyHash}`;
  try {
    const key = createPublicKey({ key: Buffer.from(device.public_key, "base64"), format: "der", type: "spki" });
    if (!verify("sha256", Buffer.from(canonical), key, Buffer.from(signatureText, "base64"))) return false;
    return store.rememberNonce(deviceId, nonce, timestamp);
  } catch { return false; }
}

export function authorized(store: StateStore, request: FastifyRequest): boolean {
  if (isLoopback(request.ip)) return true;
  const bearer = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer && store.validWebSession(bearer)) return true;
  const protocols = String(request.headers["sec-websocket-protocol"] ?? "").split(",").map((value) => value.trim());
  if (protocols[0] === "pi-web" && protocols[1] && store.validWebSession(protocols[1])) return true;
  return verifyDeviceRequest(store, request);
}
