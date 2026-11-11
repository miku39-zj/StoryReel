const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const load = require("./load-ts.cjs"),
  { generateOpenAIImage } = load("lib/server/openai-image.ts");
const { imageProtocol, imageEndpoint } = load("lib/ai/model-config.ts");
const { getDatabase, closeDatabases, writeWorkerHeartbeat, workerIsOnline } =
  load("lib/server/database.ts");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const config = {
  baseUrl: "https://images.test/v1/images/generations",
  apiKey: "private-image-key",
  model: "custom-image",
};
const names = [
  "IMAGE_PROVIDER",
  "IMAGE_BASE_URL",
  "IMAGE_API_KEY",
  "IMAGE_MODEL",
  "STORYREEL_GENERATION_MODE",
  "STORYREEL_DATA_DIR",
  "FAL_API_KEY",
];
async function isolated(fn) {
  closeDatabases();
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]])),
    fetch = global.fetch,
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "openai-image-"));
  for (const name of names) delete process.env[name];
  Object.assign(process.env, {
    IMAGE_BASE_URL: config.baseUrl,
    IMAGE_API_KEY: config.apiKey,
    IMAGE_MODEL: config.model,
    STORYREEL_DATA_DIR: dir,
  });
  try {
    await fn();
  } finally {
    closeDatabases();
    global.fetch = fetch;
    for (const [name, value] of Object.entries(previous))
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    await fs.rm(dir, { recursive: true, force: true });
  }
}
test("OpenAI image endpoint detection and explicit protocol retain fal compatibility", () =>
  isolated(async () => {
    assert.equal(imageProtocol(), "openai");
    process.env.FAL_API_KEY = "fal-only";
    delete process.env.IMAGE_API_KEY;
    assert.equal(load("lib/ai/model-config.ts").mediaConfig("image").apiKey, "");
    process.env.IMAGE_API_KEY = config.apiKey;
    assert.equal(imageEndpoint(config), config.baseUrl);
    assert.equal(
      imageEndpoint({ ...config, baseUrl: "https://images.test/v1" }),
      "https://images.test/v1/images/generations",
    );
    process.env.IMAGE_PROVIDER = "fal";
    assert.equal(imageProtocol(), "fal");
    delete process.env.IMAGE_PROVIDER;
    process.env.IMAGE_BASE_URL = "https://queue.fal.run";
    assert.equal(imageProtocol(), "fal");
    process.env.IMAGE_PROVIDER = "unsupported";
    assert.throws(imageProtocol, /IMAGE_PROVIDER/);
  }));
test("OpenAI image adapter sends model in the body, Bearer auth, and accepts Base64 or URL results", () =>
  isolated(async () => {
    let count = 0;
    global.fetch = async (url, init) => {
      count++;
      assert.equal(url, config.baseUrl);
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer private-image-key");
      const body = JSON.parse(init.body);
      assert.equal(body.model, config.model);
      assert.equal(body.n, 1);
      assert.equal(body.stream, false);
      assert.match(body.prompt, /16:9/);
      return Response.json({ data: [{ b64_json: png.toString("base64") }] });
    };
    const result = await generateOpenAIImage("portrait", { aspectRatio: "16:9" }, config);
    assert.deepEqual(Buffer.from(result.bytes), png);
    assert.equal(result.provider, "openai");
    assert.equal(count, 1);
    global.fetch = async () => Response.json({ data: [{ url: "https://media.test/image.png" }] });
    assert.equal(
      (await generateOpenAIImage("portrait", {}, config)).url,
      "https://media.test/image.png",
    );
  }));
test("invalid image responses and authentication failures fail without automatic retry or key disclosure", () =>
  isolated(async () => {
    for (const response of [
      Response.json({ data: [{ b64_json: "not an image" }] }),
      Response.json({ data: [] }),
      new Response("<html>private-key</html>"),
      Response.json({ error: "private-image-key" }, { status: 401 }),
    ]) {
      let count = 0;
      global.fetch = async () => {
        count++;
        return response;
      };
      await assert.rejects(
        () => generateOpenAIImage("portrait", {}, config),
        (error) => !error.message.includes("private-image-key"),
      );
      assert.equal(count, 1);
    }
  }));
test("shot and canvas OpenAI image paths use shared transport and create durable version records", () =>
  isolated(async () => {
    const { putProject } = load("lib/server/projects.ts"),
      { submitProduction } = load("lib/server/production.ts"),
      { getProduction } = load("lib/server/production-store.ts"),
      { workerTick } = load("lib/server/generation-worker.ts"),
      { enqueueCanvas, canvasWorkerTick } = load("lib/server/canvas-jobs.ts");
    const shot = {
      shotId: "shot",
      sceneId: "scene",
      shotIndex: 0,
      frameType: "中景",
      cameraMove: "fixed",
      lighting: "day",
      action: "walk",
      duration: 5,
      imagePrompt: "portrait",
    };
    const p = {
      id: "images",
      name: "images",
      createdAt: "now",
      updatedAt: "now",
      nodes: [
        {
          id: "image",
          type: "image",
          position: { x: 0, y: 0 },
          data: { nodeType: "image", prompt: "portrait" },
        },
      ],
      edges: [],
      creation: { storyboardShots: [shot] },
    };
    await putProject(p);
    await submitProduction("images", {
      action: "generate",
      kind: "image",
      shotIds: ["shot"],
      requestKey: "one",
    });
    enqueueCanvas(p, ["image"], "canvas");
    let count = 0;
    global.fetch = async (url) => {
      count++;
      assert.equal(url, config.baseUrl);
      return Response.json({ data: [{ b64_json: png.toString("base64") }] });
    };
    await workerTick({ projectId: "images" });
    await canvasWorkerTick("images");
    const state = await getProduction("images");
    assert.equal(state.jobs[0].status, "succeeded");
    assert.equal(state.assets[0].provider, "openai");
    assert.equal(state.assets[0].version, 1);
    assert.equal(getDatabase().prepare("SELECT count(*) AS n FROM generated_versions").get().n, 2);
    assert.equal(count, 2);
  }));
test("scoped worker never claims another project; scoped heartbeat does not mark other projects online", () =>
  isolated(async () => {
    const { putProject } = load("lib/server/projects.ts"),
      { submitProduction } = load("lib/server/production.ts"),
      { getProduction } = load("lib/server/production-store.ts"),
      { workerTick } = load("lib/server/generation-worker.ts");
    const shot = {
      shotId: "shot",
      sceneId: "scene",
      shotIndex: 0,
      frameType: "中景",
      cameraMove: "fixed",
      lighting: "day",
      action: "walk",
      duration: 5,
      imagePrompt: "portrait",
    };
    for (const id of ["other", "target"]) {
      await putProject({
        id,
        name: id,
        createdAt: "now",
        updatedAt: "now",
        nodes: [],
        edges: [],
        creation: { storyboardShots: [shot] },
      });
      await submitProduction(id, {
        action: "generate",
        kind: "image",
        shotIds: ["shot"],
        requestKey: id,
      });
    }
    await assert.rejects(() => workerTick({ projectId: "" }), /无效数据/);
    let count = 0;
    await workerTick({
      projectId: "target",
      provider: {
        submit: async () => {
          count++;
          return { state: "done", bytes: png, extension: "png", provider: "test" };
        },
        poll: async () => {
          throw Error("unexpected");
        },
      },
    });
    assert.equal(count, 1);
    assert.equal((await getProduction("other")).jobs[0].status, "queued");
    assert.equal((await getProduction("target")).jobs[0].status, "succeeded");
    writeWorkerHeartbeat(Date.now(), "target");
    assert.equal(workerIsOnline("target"), true);
    assert.equal(workerIsOnline("other"), false);
    assert.equal(workerIsOnline(), false);
    writeWorkerHeartbeat();
    assert.equal(workerIsOnline("other"), true);
  }));

test("image Agent adapter reuses OpenAI transport and returns a permanent local asset", () =>
  isolated(async () => {
    const { createImageProvider } = load("lib/ai/providers/image-provider.ts"),
      { readGeneratedMedia } = load("lib/server/generated-media.ts");
    let count = 0;
    global.fetch = async (url) => {
      count++;
      assert.equal(url, config.baseUrl);
      return Response.json({ data: [{ b64_json: png.toString("base64") }] });
    };
    const provider = createImageProvider();
    assert.equal(provider.id, "openai");
    const result = await provider.generate({ prompt: "portrait" });
    assert.equal(result.provider, "openai");
    assert.equal(result.isMock, false);
    assert.ok(result.url.startsWith("/api/media/"));
    assert.deepEqual((await readGeneratedMedia(result.url.split("/").pop())).bytes, png);
    assert.equal(count, 1);
  }));

test("reference image generation sends images to edits and never silently retries text-only", async () => {
  const { generateOpenAIImage } = load("lib/server/openai-image.ts");
  const originalFetch = global.fetch;
  let calls = [];
  try {
    global.fetch = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return Response.json({ data: [{ url: "https://example.test/result.png" }] });
    };
    const result = await generateOpenAIImage(
      "keep the face, bend down",
      { referenceImageUrls: ["https://example.test/character.png"] },
      {
        apiKey: "test",
        model: "test-image",
        baseUrl: "https://gateway.test/v1/images/generations",
      },
    );
    assert.equal(result.state, "done");
    assert.equal(calls[0].url, "https://gateway.test/v1/images/edits");
    assert.deepEqual(calls[0].body.images, [{ image_url: "https://example.test/character.png" }]);
    global.fetch = async () => {
      calls.push("failure");
      return new Response("", { status: 404 });
    };
    await assert.rejects(
      () =>
        generateOpenAIImage(
          "test",
          { referenceImageUrls: ["https://example.test/character.png"] },
          { apiKey: "test", model: "test-image", baseUrl: "https://gateway.test/v1" },
        ),
      /未退回纯文生图/,
    );
    assert.equal(calls.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Zode edits upload one reference sheet for multiple project images", () =>
  isolated(async () => {
    const { storeGeneratedMedia } = load("lib/server/generated-media.ts");
    const asset = await storeGeneratedMedia("reference", { bytes: png, extension: "png" });
    global.fetch = async (url, init) => {
      assert.equal(url, "https://zode.qa.qima-inc.com/api/v1/images/edits");
      const headers = new Headers(init.headers);
      assert.equal(headers.get("x-api-key"), config.apiKey);
      assert.equal(headers.has("content-type"), false);
      assert.equal(headers.has("authorization"), false);
      assert.equal(init.body.get("model"), "gpt-image-2.5-flare");
      assert.equal(init.body.get("size"), "1024x1024");
      assert.equal(init.body.get("n"), "1");
      const files = init.body.getAll("image");
      assert.equal(files.length, 1);
      assert.equal(files[0].type, "image/png");
      assert.match(init.body.get("prompt"), /2 panels, numbered left to right/);
      const { width, height } = await require("sharp")(
        Buffer.from(await files[0].arrayBuffer()),
      ).metadata();
      assert.equal(width, 1536);
      assert.equal(height, 768);
      return Response.json({ data: [{ b64_json: png.toString("base64") }] });
    };
    const result = await generateOpenAIImage(
      "shot",
      { referenceImageUrls: [asset, asset] },
      {
        ...config,
        baseUrl: "https://zode.qa.qima-inc.com/api/v1/images/generations",
      },
    );
    assert.deepEqual(result.bytes, png);
  }));
