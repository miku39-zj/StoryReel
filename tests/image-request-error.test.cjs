const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load-ts.cjs");
const { imageRequestError } = load("lib/server/image-request-error.ts");
const { TerminalTaskError } = load("lib/generation/lifecycle.ts");
test("image safety rejection reports the actual reason without raw body disclosure", async () => {
  const error = await imageRequestError(
    Response.json(
      {
        error: {
          code: "execution_error",
          message:
            "Your request was rejected by the safety system. safety_violations=[self-harm, violence]. private-secret",
        },
      },
      { status: 400 },
    ),
    false,
  );
  assert.ok(error instanceof TerminalTaskError);
  assert.match(error.message, /自伤、暴力/);
  assert.doesNotMatch(error.message, /private-secret|IMAGE_API_KEY/);
});
test("auth, quota, unknown bad requests and reference protocols remain distinct", async () => {
  assert.match(
    (await imageRequestError(new Response("secret", { status: 401 }), false)).message,
    /认证/,
  );
  assert.match(
    (await imageRequestError(new Response("secret", { status: 429 }), false)).message,
    /额度/,
  );
  const bad = await imageRequestError(new Response("secret", { status: 400 }), false);
  assert.match(bad.message, /生成参数/);
  assert.doesNotMatch(bad.message, /secret|IMAGE_API_KEY/);
  assert.match(
    (await imageRequestError(new Response("", { status: 404 }), true)).message,
    /未退回纯文生图/,
  );
});
