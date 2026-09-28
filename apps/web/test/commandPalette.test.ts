import assert from "node:assert/strict";
import test from "node:test";
import { commandSuggestions, selectSlashCommand, slashQuery, type SlashCommand } from "../src/commandPalette.js";

const commands: SlashCommand[] = [
  { name: "route", description: "Route task", source: "extension" },
  { name: "router", description: "Route alias", source: "extension" },
  { name: "skill:web-debug", description: "Debug web", source: "skill" },
  { name: "skill:pdf-reader", description: "Read PDF", source: "skill" },
];

test("opens only for a leading unfinished slash command", () => {
  assert.equal(slashQuery("/"), "");
  assert.equal(slashQuery("  /ROU"), "rou");
  assert.equal(slashQuery("hello /rou"), undefined);
  assert.equal(slashQuery("/route task"), undefined);
});

test("filters commands as letters are entered and ranks prefixes first", () => {
  assert.deepEqual(commandSuggestions(commands, "/rou").map((item) => item.name), ["route", "router"]);
  assert.deepEqual(commandSuggestions(commands, "/debug").map((item) => item.name), ["skill:web-debug"]);
  assert.deepEqual(commandSuggestions(commands, "/missing"), []);
});

test("selection leaves the composer ready for arguments", () => {
  assert.equal(selectSlashCommand("skill:web-debug"), "/skill:web-debug ");
});
