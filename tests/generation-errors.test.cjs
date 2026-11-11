const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load-ts.cjs");
const { describeGenerationError } = load("lib/generation/errors.ts");
const { readProviderJSON } = load("lib/server/provider-json.ts");
const { failOperation, TerminalTaskError } = load("lib/generation/lifecycle.ts");
const raw =
  "生成服务业务失败：InputImageSensitiveContentDetected.PrivacyInformation: input image may contain real person.";

test("stored input-image privacy rejection has a Chinese explanation without losing the original code", () => {
  const error = describeGenerationError(raw);
  assert.equal(error.code, "InputImageSensitiveContentDetected.PrivacyInformation");
  assert.match(error.message, /AI 生成/);
  assert.match(error.advice, /重复提交/);
  assert.equal(error.retryable, false);
  assert.equal(describeGenerationError("网络超时").message, "网络超时");
  assert.equal(describeGenerationError("网络超时").retryable, undefined);
});
test("provider image rejection stops a polled task immediately and preserves the raw diagnostic", async () => {
  let rejection;
  try {
    await readProviderJSON(Response.json({ success: false, message: raw }));
  } catch (error) {
    rejection = error;
  }
  assert.ok(rejection instanceof TerminalTaskError);
  assert.match(rejection.message, /InputImageSensitiveContentDetected.PrivacyInformation/);
  const task = { status: "running", updatedAt: "now", pollErrors: 0 };
  failOperation(task, rejection, true);
  assert.equal(task.status, "failed");
  assert.equal(task.pollErrors, 0);
  assert.equal(task.nextRunAt, undefined);
});
