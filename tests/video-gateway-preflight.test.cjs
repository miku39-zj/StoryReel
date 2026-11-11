const { test } = require("node:test"),
  assert = require("node:assert/strict");
const load = require("./load-ts.cjs");
const { readProviderJSON } = load("lib/server/provider-json.ts");
test("HTTP 200 business failures are rejected and credentials are redacted", async () => {
  const previous = process.env.VIDEO_API_KEY;
  process.env.VIDEO_API_KEY = "private-video-key";
  try {
    await assert.rejects(
      () =>
        readProviderJSON(
          Response.json({
            success: false,
            code: 7,
            message: "missing model private-video-key",
            data: null,
          }),
        ),
      (error) => error.message.includes("业务失败") && !error.message.includes("private-video-key"),
    );
  } finally {
    if (previous === undefined) delete process.env.VIDEO_API_KEY;
    else process.env.VIDEO_API_KEY = previous;
  }
  assert.deepEqual(
    await readProviderJSON(Response.json({ images: [{ url: "https://media.test/a.png" }] })),
    { images: [{ url: "https://media.test/a.png" }] },
  );
  await assert.rejects(() => readProviderJSON(new Response("<html>not json</html>")), /JSON/);
  await assert.rejects(
    () => readProviderJSON(new Response("private body", { status: 401 })),
    /401/,
  );
});
