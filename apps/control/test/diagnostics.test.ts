import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collapseRepeatedLines, readServiceLogs, redactLog } from "../src/diagnostics.js";

test("diagnostic logs keep the tail and redact secrets", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-logs-"));
  writeFileSync(join(dir, "session-launch.log"), "startup failed api_key=sk-secretvalue token: abcdefghijklmnop\n");
  const logs = readServiceLogs(dir);
  const launch = logs.find((log) => log.name === "Start sesji Pi");
  assert.ok(launch);
  assert.match(launch.text, /startup failed/);
  assert.equal(launch.text.includes("sk-secretvalue"), false);
  assert.equal(launch.text.includes("abcdefghijklmnop"), false);
  assert.equal(logs.find((log) => log.name.startsWith("Control"))?.text, "Brak wpisów.");
  assert.equal(redactLog("Authorization: Bearer eyJhbGciOi.token"), "Authorization: Bearer [redacted]");
});

test("diagnostic logs collapse repeated warnings without losing their count", () => {
  assert.deepEqual(collapseRepeatedLines(["warning", "other", "warning", "warning"]), ["warning", "other", "[×2] warning"]);
  const dir = mkdtempSync(join(tmpdir(), "pi-logs-repeat-"));
  writeFileSync(join(dir, "control.stderr.log"), "warning\nwarning\nother\n");
  const log = readServiceLogs(dir).find((item) => item.name.endsWith("stderr"));
  assert.equal(log?.lineCount, 3);
  assert.equal(log?.uniqueLineCount, 2);
  assert.match(log?.text ?? "", /\[×2\] warning/);
});

test("diagnostics read a bounded log tail rather than the whole growing file", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-log-tail-"));
  writeFileSync(join(dir, "control.stdout.log"), "x".repeat(2 * 1024 * 1024) + "\nrecent\n");
  const log = readServiceLogs(dir).find(item=>item.name.endsWith("stdout"));
  assert.equal(log?.text, "recent");
});
