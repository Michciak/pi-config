import assert from "node:assert/strict";
import test from "node:test";
import {
  default as contractExtension,
  buildResult,
  cancelledResult,
  getOtherLabel,
  normalizeOptions,
  sortAnswers,
  unavailableResult,
} from "../extensions/ask-user-question-contract.ts";

test("contract module is also a valid no-op Pi extension", () => {
  assert.equal(typeof contractExtension, "function");
  assert.equal(contractExtension(), undefined);
});

test("normalizes values and descriptions without changing explicit option values", () => {
  assert.deepEqual(normalizeOptions([{ label: " One ", value: " 1 ", description: " First " }, { label: "Two" }]), [
    { label: "One", value: "1", description: "First" },
    { label: "Two", value: "Two", description: undefined },
  ]);
});

test("disambiguates a real option named Other", () => {
  assert.equal(getOtherLabel(normalizeOptions([{ label: "Other", value: "existing" }])), "Other (custom)");
});

test("preserves exact model-facing text for text, empty text, single and multi selection", () => {
  assert.equal(buildResult("Q", undefined, "text", [{ type: "text", label: "yes", value: "yes" }]).content[0].text, "User answered: yes");
  assert.equal(buildResult("Q", undefined, "text", [{ type: "text", label: "", value: "" }]).content[0].text, "User submitted an empty response");
  assert.equal(buildResult("Q", undefined, "single-select", [{ type: "option", label: "One", value: "1", index: 1 }]).content[0].text, "User selected: 1. One");
  const answers = sortAnswers([
    { type: "other", label: "Custom", value: "Custom" },
    { type: "option", label: "Two", value: "2", index: 2 },
    { type: "option", label: "One", value: "1", index: 1 },
  ]);
  assert.equal(buildResult("Q", "details", "multi-select", answers).content[0].text,
    "User selected:\n- 1. One\n- 2. Two\n- Other: Custom");
});

test("returns the established cancelled and unavailable structures", () => {
  assert.equal(cancelledResult("Q", "text").details.status, "cancelled");
  assert.deepEqual(cancelledResult("Q", "text").details.answers, []);
  const unavailable = unavailableResult("Q", "text", "Broker down");
  assert.equal(unavailable.details.status, "unavailable");
  assert.equal(unavailable.content[0].text, "Broker down");
});
