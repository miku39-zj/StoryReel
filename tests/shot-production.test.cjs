const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const load = require("./load-ts.cjs");
const { closeDatabases } = load("lib/server/database.ts");
const { normalizeShots, shotRevision } = load("lib/production/shots.ts");
const { submitProduction } = load("lib/server/production.ts");
const { getProduction, updateProduction } = load("lib/server/production-store.ts");
const { putProject } = load("lib/server/projects.ts");
const { workerTick } = load("lib/server/generation-worker.ts");
const { generationProvider } = load("lib/server/generation-provider.ts");
const { applyProduction } = load("lib/production/apply.ts");
const { validateProject, playbackProject } = load("lib/story/graph.ts");
const { StoryRuntime } = load("lib/story/runtime.ts");
const mediaRoute = load("app/api/media/[id]/route.ts");
const api = load("app/api/projects/[id]/production/route.ts");
let temp, original;
const shot = (id, index = 0, dialogue = "test dialogue") => ({
  shotId: id,
  sceneId: "scene",
  shotIndex: index,
  frameType: "中景",
  cameraMove: "push",
  lighting: "warm",
  action: `action ${id}`,
  dialogue,
  duration: 1,
  imagePrompt: `unique prompt ${id}`,
});
const fixture = () => ({
  id: "production-test",
  name: "shots",
  createdAt: "2026-10-29T00:00:00.000Z",
  updatedAt: "2026-10-29T00:00:00.000Z",
  startNodeId: "video_scene",
  nodes: [
    {
      id: "video_scene",
      type: "video",
      position: { x: 0, y: 0 },
      data: { nodeType: "video", title: "scene" },
    },
    {
      id: "ending",
      type: "ending",
      position: { x: 500, y: 0 },
      data: { nodeType: "ending", title: "end" },
    },
  ],
  edges: [{ id: "end", source: "video_scene", target: "ending", data: { kind: "flow" } }],
  creation: {
    activeStep: "video",
    stepStatuses: {
      story: "done",
      branch: "done",
      storyboard: "done",
      visual: "idle",
      video: "idle",
      validate: "idle",
    },
    userPrompt: "",
    storyOutline: null,
    branchDesign: null,
    storyboardShots: [shot("one"), shot("two", 1, "")],
    assets: [],
    assetLibrary: [],
  },
});
const generate = (
  kind = "pipeline",
  shotIds = ["one", "two"],
  requestKey = `request-${Math.random()}`,
) => submitProduction("production-test", { action: "generate", kind, shotIds, requestKey });
const drain = async (provider = generationProvider) => {
  for (let i = 0; i < 40; i++) {
    const s = await getProduction("production-test");
    if (s.jobs.every((j) => ["succeeded", "failed"].includes(j.status))) return s;
    await workerTick({ provider, pollMs: 0 });
  }
  throw new Error("jobs did not settle");
};
before(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "storyreel-production-"));
  original = {
    root: process.env.STORYREEL_DATA_DIR,
    mode: process.env.STORYREEL_GENERATION_MODE,
    delay: process.env.STORYREEL_MOCK_DELAY_MS,
  };
  process.env.STORYREEL_DATA_DIR = temp;
  process.env.STORYREEL_GENERATION_MODE = "mock";
  process.env.STORYREEL_MOCK_DELAY_MS = "0";
});
beforeEach(async () => {
  closeDatabases();
  await fs.rm(temp, { recursive: true, force: true });
  await putProject(fixture());
});
after(async () => {
  closeDatabases();
  for (const [key, value] of Object.entries({
    STORYREEL_DATA_DIR: original.root,
    STORYREEL_GENERATION_MODE: original.mode,
    STORYREEL_MOCK_DELAY_MS: original.delay,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await fs.rm(temp, { recursive: true, force: true });
});

test("shot IDs survive legacy migration, regeneration and reordering; duplicate identities are rejected", () => {
  const legacy = shot("ignored");
  delete legacy.shotId;
  const a = normalizeShots([legacy]);
  assert.equal(normalizeShots([legacy])[0].shotId, a[0].shotId);
  assert.equal(normalizeShots([{ ...legacy, action: "edited" }], a)[0].shotId, a[0].shotId);
  assert.equal(normalizeShots([{ ...a[0], shotIndex: 4 }])[0].shotId, a[0].shotId);
  assert.throws(() => normalizeShots([shot("one"), shot("one", 1)]), /重复/);
});

test("concurrent repeated enqueue is idempotent and snapshots exact shot inputs and dependencies", async () => {
  await Promise.all([
    generate("pipeline", ["one", "two"], "same-request"),
    generate("pipeline", ["one", "two"], "same-request"),
  ]);
  let state = await getProduction("production-test");
  assert.equal(state.jobs.length, 5);
  const p = fixture();
  p.creation.storyboardShots[0].imagePrompt = "later edit";
  await putProject(p);
  state = await drain();
  assert.equal(state.assets.length, 5);
  assert.equal(
    state.jobs.find((j) => j.kind === "image" && j.shotId === "one").shot.imagePrompt,
    "unique prompt one",
  );
  const video = state.assets.find((a) => a.kind === "video" && a.shotId === "one");
  assert.equal(
    video.inputImageId,
    state.assets.find((a) => a.kind === "image" && a.shotId === "one").id,
  );
  assert.ok(state.assets.every((a) => a.url.startsWith("/api/media/")));
  assert.ok(state.jobs.every((j) => j.status === "succeeded"));
});

test("single-shot retry preserves other shots and appends versions instead of replacing results", async () => {
  await generate();
  const provider = {
    ...generationProvider,
    submit: async (job) => {
      if (job.kind === "video" && job.shotId === "one" && job.attempt === 1)
        throw new Error("temporary provider failure");
      return generationProvider.submit(job);
    },
  };
  let state = await drain(provider);
  assert.equal(state.jobs.find((j) => j.kind === "video" && j.shotId === "one").status, "failed");
  const second = state.assets.filter((a) => a.shotId === "two");
  await generate("video", ["one"]);
  state = await drain(provider);
  assert.deepEqual(
    state.assets.filter((a) => a.shotId === "two"),
    second,
  );
  const retry = state.jobs.filter((j) => j.kind === "video" && j.shotId === "one").at(-1);
  assert.equal(retry.status, "succeeded");
  assert.equal(retry.attempt, 2);
  assert.ok(retry.retryOf);
  await generate("video", ["one"]);
  state = await drain(provider);
  assert.deepEqual(
    state.assets.filter((a) => a.kind === "video" && a.shotId === "one").map((a) => a.version),
    [1, 2],
  );
});

test("version replacement persists and a late completion respects an explicit version selection", async () => {
  await generate("image", ["one"]);
  let state = await drain();
  const first = state.assets[0];
  await generate("image", ["one"]);
  state = await drain();
  assert.equal(state.assets.length, 2);
  await submitProduction("production-test", { action: "select", assetId: first.id });
  assert.equal((await getProduction("production-test")).selected.one.image, first.id);
  await generate("image", ["one"]);
  await workerTick({ pollMs: 0 });
  await submitProduction("production-test", { action: "select", assetId: first.id });
  state = await drain();
  assert.equal(state.assets.length, 3);
  assert.equal(state.selected.one.image, first.id);
});

test("external task identity survives a fresh worker process and is polled without duplicate submissions", async () => {
  await generate("image", ["one"]);
  await workerTick({ pollMs: 0 });
  const pending = (await getProduction("production-test")).jobs[0];
  assert.equal(pending.stage, "polling");
  assert.equal(pending.providerTask.requestId, pending.id);
  const { execFileSync } = require("node:child_process");
  execFileSync(
    process.execPath,
    [
      "-e",
      `require(${JSON.stringify(path.resolve(__dirname, "load-ts.cjs"))})('lib/server/generation-worker.ts').workerTick({pollMs:0})`,
    ],
    { env: process.env },
  );
  const state = await getProduction("production-test");
  assert.equal(state.jobs.length, 1);
  assert.equal(state.assets.length, 1);
  assert.equal(state.jobs[0].status, "succeeded");
  assert.equal(state.jobs[0].providerTask.requestId, pending.id);
});

test("interrupted unknown submissions fail safely rather than billing a second submission", async () => {
  await generate("audio", ["one"]);
  await updateProduction("production-test", (s) => {
    s.jobs[0].status = "running";
    s.jobs[0].stage = "submitting";
    s.jobs[0].leaseUntil = 0;
  });
  let calls = 0;
  await workerTick({
    provider: {
      submit: async () => {
        calls++;
        throw new Error("must not submit");
      },
      poll: async () => {
        throw new Error("must not poll");
      },
    },
  });
  const state = await getProduction("production-test");
  assert.equal(calls, 0);
  assert.equal(state.jobs[0].status, "failed");
  assert.match(state.jobs[0].error, /中断/);
});

test("scene playback uses ordered shot video/audio versions and stale storyboard application is rejected", async () => {
  await generate();
  const state = await drain();
  const p = applyProduction(fixture(), state);
  assert.equal(p.nodes[0].data.segments.length, 2);
  assert.equal(validateProject(p).valid, true);
  const runtime = new StoryRuntime(p.nodes, p.edges, p.startNodeId);
  assert.equal(
    runtime.snapshot().currentAudioUrl,
    state.assets.find((a) => a.kind === "audio").url,
  );
  assert.equal(runtime.snapshot().currentVideoEnd, 1);
  assert.equal(runtime.advance().id, "video_scene__two");
  assert.equal(runtime.snapshot().currentAudioUrl, undefined);
  assert.equal(runtime.advance().id, "ending");
  const published = playbackProject(p);
  assert.equal(published.nodes[0].data.segments[0].sourceRevision, undefined);
  assert.equal(
    new StoryRuntime(published.nodes, published.edges, published.startNodeId).advance().id,
    "video_scene__two",
  );
  p.creation.storyboardShots[0].dialogue = "new dialogue";
  assert.equal(validateProject(p).valid, false);
  assert.throws(() => applyProduction(p, state), /当前分镜/);
});

test("production state is independent of draft autosaves and media supports byte ranges", async () => {
  await generate("image", ["one"]);
  const state = await drain();
  await putProject(fixture());
  assert.equal((await getProduction("production-test")).assets.length, 1);
  const id = state.assets[0].id;
  const response = await mediaRoute.GET(
    new Request("http://localhost/api/media/" + id, { headers: { range: "bytes=0-7" } }),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal((await response.arrayBuffer()).byteLength, 8);
  const invalid = await mediaRoute.GET(
    new Request("http://localhost", { headers: { range: "bytes=9999999-" } }),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(invalid.status, 416);
});

test("real mode reports missing credentials instead of marking placeholders as finished", async () => {
  const key = process.env.OPENAI_API_KEY,
    mode = process.env.STORYREEL_GENERATION_MODE;
  delete process.env.OPENAI_API_KEY;
  delete process.env.STORYREEL_GENERATION_MODE;
  try {
    await assert.rejects(
      () => generationProvider.submit({ kind: "audio", shot: shot("one") }),
      /OPENAI_API_KEY/,
    );
  } finally {
    if (key !== undefined) process.env.OPENAI_API_KEY = key;
    process.env.STORYREEL_GENERATION_MODE = mode;
  }
});

test("API rejects nonexistent shots and blank dialogue before enqueueing", async () => {
  const ctx = { params: Promise.resolve({ id: "production-test" }) };
  const req = (body) =>
    new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });
  assert.equal(
    (
      await api.POST(
        req({ action: "generate", kind: "image", shotIds: ["missing"], requestKey: "a" }),
        ctx,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await api.POST(
        req({ action: "generate", kind: "audio", shotIds: ["two"], requestKey: "b" }),
        ctx,
      )
    ).status,
    400,
  );
  assert.equal((await getProduction("production-test")).jobs.length, 0);
});

test("canvas media is persisted into shot production, survives reload and pipeline does not regenerate it", async () => {
  const p = fixture();
  p.creation.storyboardShots = [shot("one", 0, "")];
  Object.assign(p.nodes[0].data, {
    videoUrl: "/api/media/already-generated",
    generationStatus: "done",
  });
  await putProject(p);
  let response = await api.GET(new Request("http://localhost"), {
    params: Promise.resolve({ id: p.id }),
  });
  let state = await response.json();
  assert.equal(state.assets.length, 1);
  assert.equal(state.assets[0].provider, "canvas");
  assert.equal(state.selected.one.video, state.assets[0].id);
  await generate("pipeline", ["one"]);
  state = await getProduction(p.id);
  assert.equal(state.jobs.length, 0);
  assert.equal(state.assets.length, 1);
  closeDatabases();
  response = await api.GET(new Request("http://localhost"), {
    params: Promise.resolve({ id: p.id }),
  });
  state = await response.json();
  assert.equal(state.assets.length, 1);
  const updated = await require("./load-ts.cjs")("lib/server/projects.ts").getProject(p.id);
  updated.creation.storyboardShots[0].action = "changed storyboard";
  await putProject(updated);
  await api.GET(new Request("http://localhost"), { params: Promise.resolve({ id: p.id }) });
  state = await getProduction(p.id);
  assert.notEqual(
    state.assets[0].sourceRevision,
    shotRevision(updated.creation.storyboardShots[0]),
  );
});

test("a scene video is never duplicated across multiple shots", async () => {
  const p = fixture();
  p.nodes[0].data.videoUrl = "/api/media/whole-scene";
  await putProject(p);
  const response = await api.GET(new Request("http://localhost"), {
    params: Promise.resolve({ id: p.id }),
  });
  assert.equal((await response.json()).assets.length, 0);
});
