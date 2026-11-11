const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const load = require("./load-ts.cjs");
const { textConfig, mediaConfig, audioConfig, providerUrl, modelUrl } =
  load("lib/ai/model-config.ts");
const names = [
  "TEXT_PROVIDER",
  "TEXT_BASE_URL",
  "TEXT_API_KEY",
  "TEXT_MODEL",
  "IMAGE_BASE_URL",
  "IMAGE_API_KEY",
  "IMAGE_MODEL",
  "VIDEO_BASE_URL",
  "VIDEO_API_KEY",
  "VIDEO_MODEL",
  "AUDIO_BASE_URL",
  "AUDIO_API_KEY",
  "AUDIO_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "MODEL_NAME",
  "FAL_API_KEY",
  "STORYREEL_GENERATION_MODE",
  "STORYREEL_DATA_DIR",
];
async function isolated(env, fn) {
  const previous = Object.fromEntries(names.map((k) => [k, process.env[k]])),
    fetch = global.fetch;
  for (const k of names) delete process.env[k];
  Object.assign(process.env, env);
  try {
    await fn();
  } finally {
    global.fetch = fetch;
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
test("text, image, video and audio settings are isolated with explicit legacy fallbacks", () =>
  isolated(
    {
      TEXT_API_KEY: "text",
      TEXT_MODEL: "chat",
      TEXT_BASE_URL: "https://text.test/v1/",
      IMAGE_API_KEY: "image",
      IMAGE_MODEL: "vendor/image",
      IMAGE_BASE_URL: "https://image.test/queue",
      VIDEO_API_KEY: "video",
      VIDEO_MODEL: "vendor/video",
      VIDEO_BASE_URL: "https://video.test/queue",
      AUDIO_API_KEY: "audio",
      AUDIO_MODEL: "speech",
      AUDIO_BASE_URL: "https://audio.test/v1",
      ANTHROPIC_API_KEY: "legacy-anthropic",
      OPENAI_API_KEY: "legacy-openai",
      FAL_API_KEY: "legacy-fal",
    },
    async () => {
      assert.deepEqual(textConfig(), {
        provider: "openai",
        apiKey: "text",
        model: "chat",
        baseUrl: "https://text.test/v1",
      });
      assert.equal(mediaConfig("image").apiKey, "image");
      assert.equal(mediaConfig("video").apiKey, "video");
      assert.equal(audioConfig().apiKey, "audio");
      delete process.env.IMAGE_API_KEY;
      assert.equal(mediaConfig("image").apiKey, "legacy-fal");
      delete process.env.FAL_API_KEY;
      assert.equal(mediaConfig("image").apiKey, "");
      assert.equal(mediaConfig("video").apiKey, "video");
      delete process.env.TEXT_API_KEY;
      delete process.env.TEXT_MODEL;
      delete process.env.TEXT_BASE_URL;
      assert.equal(textConfig().provider, "anthropic");
      assert.equal(textConfig().apiKey, "legacy-anthropic");
      process.env.TEXT_PROVIDER = "deepseek";
      process.env.DEEPSEEK_API_KEY = "ds";
      assert.equal(textConfig().apiKey, "ds");
    },
  ));
test("provider callback URLs cannot send credentials outside configured origin and path", () =>
  isolated({}, async () => {
    const config = { baseUrl: "https://proxy.test/fal", apiKey: "secret", model: "vendor/image" };
    assert.equal(modelUrl(config), "https://proxy.test/fal/vendor/image");
    assert.equal(
      providerUrl("https://proxy.test/fal/tasks/1?logs=1", config),
      "https://proxy.test/fal/tasks/1?logs=1",
    );
    for (const url of [
      "https://other.test/fal/tasks/1",
      "https://proxy.test/other",
      "https://proxy.test/fal/../other",
      "https://user:pass@proxy.test/fal/tasks",
    ])
      assert.throws(() => providerUrl(url, config), /不匹配/);
    for (const model of [
      "https://evil.test",
      "../escape",
      "vendor/../escape",
      "vendor/image?key=secret",
    ])
      assert.throws(() => modelUrl(config, model), /模型/);
    process.env.TEXT_BASE_URL = "https://user:password@proxy.test/v1";
    assert.throws(textConfig, /Base URL/);
    process.env.TEXT_BASE_URL = "file:///tmp/model";
    assert.throws(textConfig, /Base URL/);
  }));
test("OpenAI-compatible text requests use the configured base, key and model", () =>
  isolated(
    {
      TEXT_API_KEY: "text-only-key",
      TEXT_BASE_URL: "https://text.test/gateway/v1",
      TEXT_MODEL: "my-chat",
    },
    async () => {
      let call;
      global.fetch = async (url, init) => {
        call = { url: String(url), headers: init.headers, body: JSON.parse(init.body) };
        return Response.json({
          id: "test",
          object: "chat.completion",
          created: 1,
          model: "my-chat",
          choices: [
            { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        });
      };
      const provider = load("lib/ai/providers/text-provider.ts").createTextProvider();
      const { generateText } = require("ai");
      assert.equal(
        (await generateText({ model: provider.model, prompt: "hello", maxRetries: 0 })).text,
        "ok",
      );
      assert.equal(call.url, "https://text.test/gateway/v1/chat/completions");
      assert.equal(new Headers(call.headers).get("authorization"), "Bearer text-only-key");
      assert.equal(call.body.model, "my-chat");
    },
  ));
test("shot requests and recovery use separate image/video endpoints and credentials", () =>
  isolated(
    {
      IMAGE_API_KEY: "image-key",
      IMAGE_BASE_URL: "https://image.test/queue",
      IMAGE_MODEL: "vendor/image",
      VIDEO_API_KEY: "video-key",
      VIDEO_BASE_URL: "https://video.test/queue",
      VIDEO_MODEL: "vendor/video",
      AUDIO_API_KEY: "audio-key",
      AUDIO_BASE_URL: "https://audio.test/v1",
      AUDIO_MODEL: "my-tts",
    },
    async () => {
      const { generationProvider } = load("lib/server/generation-provider.ts");
      const calls = [];
      global.fetch = async (url, init) => {
        calls.push({
          url,
          auth: new Headers(init.headers).get("authorization"),
          body: init.body && JSON.parse(init.body),
        });
        if (url.endsWith("/audio/speech")) return new Response("ID3test");
        if (url.endsWith("/status")) return Response.json({ status: "COMPLETED" });
        if (url.endsWith("/result"))
          return Response.json({ images: [{ url: "https://media.test/image" }] });
        return Response.json({
          request_id: "id",
          status_url: `${url}/requests/id/status`,
          response_url: `${url}/requests/id/result`,
        });
      };
      const shot = {
        shotId: "s",
        sceneId: "scene",
        shotIndex: 0,
        imagePrompt: "portrait",
        action: "walk",
        frameType: "中景",
        cameraMove: "fixed",
        lighting: "day",
        duration: 5,
        dialogue: "hello",
      };
      const image = { id: "i", kind: "image", shot };
      const pending = await generationProvider.submit(image);
      assert.equal(calls[0].url, "https://image.test/queue/vendor/image");
      assert.equal(calls[0].auth, "Key image-key");
      process.env.IMAGE_MODEL = "vendor/replacement";
      await generationProvider.poll({ ...image, providerTask: pending.task });
      assert.ok(calls[1].url.includes("/vendor/image/requests/id/status"));
      assert.equal(calls[1].auth, "Key image-key");
      await generationProvider.submit({
        id: "v",
        kind: "video",
        shot,
        inputImageUrl: "https://media.test/first-frame",
      });
      const video = calls.find((c) => c.url === "https://video.test/queue/vendor/video");
      assert.equal(video.auth, "Key video-key");
      assert.equal(video.body.image_url, "https://media.test/first-frame");
      await generationProvider.submit({ id: "a", kind: "audio", shot });
      const audio = calls.at(-1);
      assert.equal(audio.url, "https://audio.test/v1/audio/speech");
      assert.equal(audio.auth, "Bearer audio-key");
      assert.equal(audio.body.model, "my-tts");
      process.env.IMAGE_BASE_URL = "https://changed.test/queue";
      const before = calls.length;
      await assert.rejects(
        () => generationProvider.poll({ ...image, providerTask: pending.task }),
        /不匹配/,
      );
      assert.equal(calls.length, before);
    },
  ));
test("canvas image and video generation respect independent gateway configuration", () =>
  isolated(
    {
      IMAGE_API_KEY: "canvas-image",
      IMAGE_BASE_URL: "https://image.test/fal",
      IMAGE_MODEL: "vendor/image",
      VIDEO_API_KEY: "canvas-video",
      VIDEO_BASE_URL: "https://video.test/fal",
      VIDEO_MODEL: "vendor/video",
    },
    async () => {
      const { closeDatabases } = load("lib/server/database.ts"),
        { enqueueCanvas, canvasWorkerTick, canvasJobs } = load("lib/server/canvas-jobs.ts");
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "model-canvas-"));
      process.env.STORYREEL_DATA_DIR = dir;
      closeDatabases();
      const calls = [];
      global.fetch = async (url, init) => {
        calls.push({ url, auth: new Headers(init.headers).get("authorization") });
        return Response.json({
          request_id: "id",
          status_url: `${url}/requests/id/status`,
          response_url: `${url}/requests/id/result`,
        });
      };
      try {
        const project = {
          id: "p",
          nodes: [
            { id: "i", type: "image", data: { nodeType: "image", prompt: "portrait" } },
            { id: "v", type: "video", data: { nodeType: "video", scenePrompt: "walk" } },
          ],
          edges: [],
        };
        enqueueCanvas(project, ["i", "v"], "one");
        await canvasWorkerTick("p");
        await canvasWorkerTick("p");
        assert.deepEqual(calls, [
          { url: "https://image.test/fal/vendor/image", auth: "Key canvas-image" },
          { url: "https://video.test/fal/vendor/video", auth: "Key canvas-video" },
        ]);
        assert.equal(canvasJobs("p").filter((j) => j.status === "running").length, 2);
      } finally {
        closeDatabases();
        await fs.rm(dir, { recursive: true, force: true });
      }
    },
  ));
test("configuration status reports independent services without leaking secrets", () =>
  isolated({ TEXT_API_KEY: "text-secret", IMAGE_API_KEY: "image-secret" }, async () => {
    const { GET } = load("app/api/config/check/route.ts");
    const response = await GET(),
      data = await response.json();
    assert.equal(data.text, true);
    assert.equal(data.image, true);
    assert.equal(data.video, false);
    assert.equal(data.audio, false);
    assert.equal(JSON.stringify(data).includes("secret"), false);
  }));
test("video model display follows the server override while keeping endpoint and key private", () =>
  isolated(
    {
      VIDEO_MODEL: "doubao-seedance-2-5",
      VIDEO_BASE_URL: "https://private-gateway.test/yz/v1/videos/generations",
      VIDEO_API_KEY: "private-video-key",
    },
    async () => {
      const { GET } = load("app/api/config/check/route.ts");
      const data = await (await GET()).json();
      assert.equal(data.videoModelOverride, "doubao-seedance-2-5");
      assert.equal(data.video, true);
      assert.equal(JSON.stringify(data).includes("private-video-key"), false);
      assert.equal(JSON.stringify(data).includes("private-gateway.test"), false);
      delete process.env.VIDEO_MODEL;
      assert.equal((await (await GET()).json()).videoModelOverride, null);
    },
  ));
