import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, verifyDeviceRequest } from "../src/auth.ts";
import { StateStore } from "../src/store.ts";

test("verifies signed device decisions and rejects nonce replay", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-auth-"));
  const store = new StateStore(join(directory, "state.sqlite"));
  try {
    const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const publicKey = pair.publicKey.export({ type: "spki", format: "der" }).toString("base64");
    store.upsertDevice({ id: "phone", name: "Phone", publicKey });
    const body = { decision: "approve" };
    const timestamp = String(Date.now());
    const nonce = "unique";
    const path = "/api/v1/approvals/123/decision";
    const hash = createHash("sha256").update(canonicalJson(body)).digest("hex");
    const canonical = `${timestamp}\n${nonce}\nPOST\n${path}\n${hash}`;
    const signature = sign("sha256", Buffer.from(canonical), pair.privateKey).toString("base64");
    const request = { headers: {
      "x-pi-device": "phone", "x-pi-timestamp": timestamp, "x-pi-nonce": nonce, "x-pi-signature": signature,
    }, url: path, method: "POST", body } as any;
    assert.equal(verifyDeviceRequest(store, request), true);
    assert.equal(verifyDeviceRequest(store, request), false);
  } finally { store.close(); }
});

test("does not consume a nonce for an invalid signature", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-auth-"));
  const store = new StateStore(join(directory, "state.sqlite"));
  try {
    const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
    store.upsertDevice({ id: "phone", name: "Phone", publicKey: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64") });
    const request = { headers: {
      "x-pi-device": "phone", "x-pi-timestamp": String(Date.now()), "x-pi-nonce": "available", "x-pi-signature": Buffer.from("bad").toString("base64"),
    }, url: "/api/v1/status", method: "GET", body: undefined } as any;
    assert.equal(verifyDeviceRequest(store, request), false);
    assert.equal(store.hasNonce("phone", "available"), false);
  } finally { store.close(); }
});
