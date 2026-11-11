const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load-ts.cjs");
const { buildSeedanceRequest } = load("lib/ai/seedance-request.ts");
const { POST } = load("app/api/ai/seedance/route.ts");

test("multimodal inputs reach the provider with both images and videos", () => {
  const result = buildSeedanceRequest({
    prompt: "follow @Image1 and @Video1",
    model: "seedance-2-0",
    referenceImageUrls: ["https://example.com/a.png", "https://example.com/b.png"],
    referenceVideoUrls: ["https://example.com/r.mp4"],
    generateAudio: true,
  });
  assert.equal(result.endpoint, "bytedance/seedance-2.0/reference-to-video");
  assert.deepEqual(result.input.image_urls, [
    "https://example.com/a.png",
    "https://example.com/b.png",
  ]);
  assert.deepEqual(result.input.video_urls, ["https://example.com/r.mp4"]);
  assert.equal(result.input.generate_audio, true);
});
test("frame requests use the actual first/end frame fields", () => {
  const { endpoint, input } = buildSeedanceRequest({
    prompt: "motion",
    mode: "first-last-frame",
    firstFrameUrl: "https://example.com/f.png",
    lastFrameUrl: "https://example.com/l.png",
  });
  assert.equal(endpoint, "bytedance/seedance-2.0/image-to-video");
  assert.equal(input.image_url, "https://example.com/f.png");
  assert.equal(input.end_image_url, "https://example.com/l.png");
  assert.ok(!("image_urls" in input));
});
test("invalid or incompatible media combinations fail before provider submission", () => {
  assert.throws(() => buildSeedanceRequest({ prompt: "motion", mode: "first-last-frame" }), /首帧/);
  assert.throws(
    () =>
      buildSeedanceRequest({
        prompt: "motion",
        firstFrameUrl: "https://example.com/a.png",
        referenceImageUrls: ["https://example.com/b.png"],
      }),
    /不能混用/,
  );
  assert.throws(
    () =>
      buildSeedanceRequest({
        prompt: "motion",
        model: "seedance-1-0-lite",
        referenceVideoUrls: ["https://example.com/r.mp4"],
      }),
    /Seedance 2.0/,
  );
  assert.throws(() =>
    buildSeedanceRequest({
      prompt: "motion",
      referenceImageUrls: Array(10).fill("https://example.com/a.png"),
    }),
  );
});
test("the route sends resolved inputs and returns the generated output (mock provider, no paid calls)", async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.FAL_API_KEY;
  let sent;
  process.env.FAL_API_KEY = "test-key";
  global.fetch = async (url, options) => {
    assert.equal(url, "https://queue.fal.run/bytedance/seedance-2.0/reference-to-video");
    sent = JSON.parse(options.body);
    return Response.json({ video: { url: "https://example.com/output.mp4" } });
  };
  try {
    const response = await POST(
      new Request("http://localhost/api/ai/seedance", {
        method: "POST",
        body: JSON.stringify({
          prompt: "two characters",
          referenceImageUrls: ["https://example.com/a.png", "https://example.com/b.png"],
        }),
      }),
    );
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.deepEqual(sent.image_urls, ["https://example.com/a.png", "https://example.com/b.png"]);
    assert.match(text, /output.mp4/);
    const invalid = await POST(
      new Request("http://localhost/api/ai/seedance", {
        method: "POST",
        body: JSON.stringify({ prompt: "motion", mode: "first-last-frame" }),
      }),
    );
    assert.equal(invalid.status, 400);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FAL_API_KEY;
    else process.env.FAL_API_KEY = originalKey;
  }
});
