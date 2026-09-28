import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOptions, validateQuestionAnswers, type UserQuestion } from "../src/index.ts";

function question(overrides: Partial<UserQuestion> = {}): UserQuestion {
  return {
    id: "q1",
    sessionId: "s1",
    source: { kind: "orchestrator" },
    question: "Choose",
    mode: "single-select",
    options: normalizeOptions([{ label: "One", value: "1" }]),
    allowOther: true,
    status: "pending",
    answers: [],
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

test("normalizes values and disambiguates Other", () => {
  const options = normalizeOptions([{ label: " Other " }, { label: " Two ", value: "" }]);
  assert.equal(options[0]?.value, "Other");
  assert.equal(options[1]?.value, "Two");
  assert.equal(options[2]?.label, "Other (custom)");
});

test("validates text, single and multi answers", () => {
  assert.equal(validateQuestionAnswers(question({ mode: "text", options: [] }), [{ type: "text", label: "", value: "" }]), null);
  assert.equal(validateQuestionAnswers(question(), [{ type: "option", label: "One", value: "1", index: 1 }]), null);
  assert.match(validateQuestionAnswers(question(), []), /exactly one/i);
  assert.equal(validateQuestionAnswers(question({ mode: "multi-select" }), [{ type: "other", label: "Custom", value: "Custom" }]), null);
});

test("rejects inconsistent, duplicate, late and empty Other answers", () => {
  assert.match(validateQuestionAnswers(question({ mode: "text", options: [] }), [{ type: "text", label: "a", value: "b" }])!, /consistent/i);
  const answer = { type: "option" as const, label: "One", value: "1", index: 1 };
  assert.match(validateQuestionAnswers(question({ mode: "multi-select" }), [answer, answer])!, /more than once/i);
  assert.match(validateQuestionAnswers(question(), [{ type: "other", label: "", value: "" }])!, /non-empty/i);
  assert.match(validateQuestionAnswers(question({ status: "answered" }), [answer])!, /no longer pending/i);
});
