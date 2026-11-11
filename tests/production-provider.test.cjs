const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const load = require("./load-ts.cjs");
const { closeDatabases } = load("lib/server/database.ts");
const { putProject } = load("lib/server/projects.ts");
const { submitProduction } = load("lib/server/production.ts");
const { getProduction } = load("lib/server/production-store.ts");
const { workerTick } = load("lib/server/generation-worker.ts");

test("real adapters submit shot prompts, persist queue URLs, generate speech and reuse stored image bytes", async () => {
  const previous = {
    fetch: global.fetch,
    root: process.env.STORYREEL_DATA_DIR,
    mode: process.env.STORYREEL_GENERATION_MODE,
    fal: process.env.FAL_API_KEY,
    openai: process.env.OPENAI_API_KEY,
  };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "storyreel-adapter-"));
  process.env.STORYREEL_DATA_DIR = root;
  delete process.env.STORYREEL_GENERATION_MODE;
  process.env.FAL_API_KEY = "test-fal-key";
  process.env.OPENAI_API_KEY = "test-openai-key";
  const calls = [];
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  global.fetch = async (url, options = {}) => {
    calls.push({ url, body: options.body ? JSON.parse(options.body) : null });
    if (url === "https://queue.fal.run/fal-ai/flux/schnell")
      return Response.json({
        request_id: "image-1",
        status_url: "https://queue.fal.run/custom/image/status",
        response_url: "https://queue.fal.run/custom/image/result",
      });
    if (url === "https://queue.fal.run/bytedance/seedance-2.0/image-to-video")
      return Response.json({
        request_id: "video-1",
        status_url: "https://queue.fal.run/custom/video/status",
        response_url: "https://queue.fal.run/custom/video/result",
      });
    if (url.endsWith("/status")) return Response.json({ status: "COMPLETED" });
    if (url.endsWith("image/result"))
      return Response.json({ images: [{ url: "https://media.test/image.png" }] });
    if (url.endsWith("video/result"))
      return Response.json({ video: { url: "https://media.test/video.mp4" } });
    if (url === "https://media.test/image.png") return new Response(png);
    if (url === "https://media.test/video.mp4")
      return new Response(await fs.readFile(path.join(__dirname, "fixtures/segment.mp4")));
    if (url === "https://api.openai.com/v1/audio/speech")
      return new Response(Buffer.from("ID3fixture"));
    throw new Error("unexpected request: " + url);
  };
  try {
    const shot = {
      shotId: "shot-1",
      sceneId: "scene",
      shotIndex: 0,
      frameType: "特写",
      cameraMove: "push",
      lighting: "warm",
      action: "open letter",
      dialogue: "The secret is here.",
      duration: 6,
      imagePrompt: "SHOT SPECIFIC VISUAL",
    };
    await putProject({
      id: "provider-test",
      name: "test",
      nodes: [],
      edges: [],
      createdAt: "2026-10-29T00:00:00.000Z",
      updatedAt: "2026-10-29T00:00:00.000Z",
      creation: { storyboardShots: [shot] },
    });
    await submitProduction("provider-test", {
      action: "generate",
      kind: "pipeline",
      shotIds: ["shot-1"],
      requestKey: "pipeline",
    });
    for (let i = 0; i < 10; i++) await workerTick({ pollMs: 0 });
    const state = await getProduction("provider-test");
    assert.ok(
      state.jobs.every((j) => j.status === "succeeded"),
      JSON.stringify(state.jobs),
    );
    assert.equal(state.assets.length, 3);
    const image = calls.find((c) => c.url === "https://queue.fal.run/fal-ai/flux/schnell");
    assert.match(image.body.prompt, /SHOT SPECIFIC VISUAL/);
    assert.match(image.body.prompt, /open letter/);
    const speech = calls.find((c) => c.url === "https://api.openai.com/v1/audio/speech");
    assert.equal(speech.body.input, shot.dialogue);
    const video = calls.find(
      (c) => c.url === "https://queue.fal.run/bytedance/seedance-2.0/image-to-video",
    );
    assert.ok(video.body.image_url.startsWith("data:image/png;base64,"));
    assert.equal(video.body.image_url.split(",")[1], png.toString("base64"));
    assert.equal(video.body.duration, 8);
    assert.equal(video.body.generate_audio, false);
    assert.equal(state.jobs.find((j) => j.kind === "video").providerTask.requestId, "video-1");
    assert.equal(
      calls.filter((c) => c.url === "https://queue.fal.run/bytedance/seedance-2.0/image-to-video")
        .length,
      1,
    );
  } finally {
    closeDatabases();
    global.fetch = previous.fetch;
    for (const [key, value] of Object.entries({
      STORYREEL_DATA_DIR: previous.root,
      STORYREEL_GENERATION_MODE: previous.mode,
      FAL_API_KEY: previous.fal,
      OPENAI_API_KEY: previous.openai,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});
