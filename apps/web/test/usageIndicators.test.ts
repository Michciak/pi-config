import test from "node:test";
import assert from "node:assert/strict";
import {contextUsagePercent, quotaUsagePercent, usageSeverity, usageHint} from "../src/usageIndicators.js";

test("usage warning thresholds and missing limits are explicit", () => {
  assert.equal(usageSeverity(undefined), "normal");
  assert.equal(usageSeverity(79.99), "normal");
  assert.equal(usageSeverity(80), "warning");
  assert.equal(usageSeverity(95), "critical");
  assert.match(usageHint(96), /limit prawie wyczerpany/);
  assert.equal(contextUsagePercent({tokens:80},100),80);
  assert.equal(contextUsagePercent({percent:95,tokens:0,contextWindow:100}),95);
  assert.equal(contextUsagePercent({tokens:10,contextWindow:0}),undefined);
  assert.equal(contextUsagePercent({tokens:NaN,contextWindow:100}),undefined);
});
test("quota severity uses the closest real money, bucket or API limit", () => {
  assert.equal(quotaUsagePercent({state:"available",buckets:{rolling:{percent:12},weekly:{percent:96}}}),96);
  assert.equal(usageSeverity(quotaUsagePercent({state:"available",limit:10,remaining:1})),"warning");
  assert.equal(quotaUsagePercent({state:"available",limit:100,used:95}),95);
  assert.equal(quotaUsagePercent({state:"subscription",rate:{remainingRequests:0,limitRequests:50}}),100);
  assert.equal(quotaUsagePercent({state:"key-ok"}),undefined);
  assert.equal(quotaUsagePercent({state:"available",used:95}),undefined);
  assert.equal(quotaUsagePercent({state:"available",limit:0,remaining:0}),undefined);
  assert.equal(quotaUsagePercent({state:"available",buckets:{rolling:{percent:NaN}}}),undefined);
});
