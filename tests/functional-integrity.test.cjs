const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const load = require("./load-ts.cjs");
const { getDatabase, closeDatabases } = load("lib/server/database.ts");
const { validateProject, playbackProject } = load("lib/story/graph.ts");
const { StoryRuntime } = load("lib/story/runtime.ts");
const { parseProject } = load("lib/story/project-schema.ts");
const { newProject } = load("lib/story/new-project.ts");
const { generatedImageResult } = load("lib/ai/image-result.ts");
const { generateImageTool } = load("lib/ai/tools/media-tools.ts");
const { useCanvasStore: canvas } = load("stores/canvas-store.ts");
const { useCreationStore: creation } = load("stores/creation-store.ts");
const projects = load("app/api/projects/route.ts");
const publish = load("app/api/projects/[id]/publish/route.ts");
const publications = load("app/api/publications/[id]/route.ts");
const history = load("app/api/projects/[id]/publications/route.ts");
const assets = load("app/api/assets/route.ts");
const { readGeneratedMedia } = load("lib/server/generated-media.ts");
const { providerMediaUrl } = load("lib/server/provider-media.ts");
let directory, previous;
before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "storyreel-integrity-"));
  previous = process.env.STORYREEL_DATA_DIR;
  process.env.STORYREEL_DATA_DIR = directory;
});
after(async () => {
  closeDatabases();
  if (previous === undefined) delete process.env.STORYREEL_DATA_DIR;
  else process.env.STORYREEL_DATA_DIR = previous;
  await fs.rm(directory, { recursive: true, force: true });
});
const node = (id, type, data = {}) => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { nodeType: type, title: id, ...data },
});
const edge = (id, source, target, data = {}) => ({
  id,
  source,
  target,
  data: { kind: "flow", ...data },
});
const fixture = (id = "integrity") => ({
  id,
  name: "回归故事",
  createdAt: "2026-10-30T00:00:00.000Z",
  updatedAt: "2026-10-30T00:00:00.000Z",
  startNodeId: "video",
  nodes: [
    node("video", "video", { videoUrl: "/video.mp4", audioUrl: "/voice.mp3", clipEnd: 2 }),
    node("end", "ending"),
  ],
  edges: [edge("ve", "video", "end")],
});
const context = (id) => ({ params: Promise.resolve({ id }) });
const request = (body, headers = {}) =>
  new Request("http://localhost/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

test("default example reaches legal endings after videos are supplied", () => {
  const p = load("lib/story/demo.ts").createDemoProject();
  p.nodes = p.nodes.map((n) =>
    n.type === "video" ? { ...n, data: { ...n.data, videoUrl: "/fixture.mp4", duration: 10 } } : n,
  );
  assert.equal(validateProject(p).valid, true, JSON.stringify(validateProject(p).errors));
  const legacy = structuredClone(p),
    merge = legacy.nodes.find((n) => n.id === "node_merge");
  merge.type = "merge";
  merge.data = { nodeType: "merge", label: "命运交汇" };
  const repaired = load("lib/story/demo.ts").repairLegacyDemo(legacy);
  assert.equal(validateProject(repaired).valid, true);
  assert.equal(repaired.nodes[0].data.videoUrl, "/fixture.mp4");
});
test("initial variables, route assignments and conditional endings survive publication and reset", () => {
  const p = {
    ...fixture(),
    initialVariables: { trust: 0 },
    nodes: [
      node("video", "video", { videoUrl: "/video.mp4" }),
      node("choice", "choice"),
      node("condition", "condition", { variable: "trust", operator: ">=", value: 2 }),
      node("yes", "ending"),
      node("no", "ending"),
    ],
    edges: [
      edge("vc", "video", "choice"),
      edge("accept", "choice", "condition", { choiceLabel: "相信", setVariables: { trust: 2 } }),
      edge("refuse", "choice", "condition", { choiceLabel: "拒绝", setVariables: { trust: 0 } }),
      edge("yes", "condition", "yes", { condition: "true" }),
      edge("no", "condition", "no", { condition: "false" }),
    ],
  };
  assert.equal(validateProject(p).valid, true);
  const snapshot = playbackProject(p),
    runtime = new StoryRuntime(
      snapshot.nodes,
      snapshot.edges,
      snapshot.startNodeId,
      snapshot.initialVariables,
    );
  runtime.choose("accept");
  assert.equal(runtime.current.id, "yes");
  assert.equal(runtime.snapshot().variables.trust, 2);
  runtime.reset();
  assert.equal(runtime.snapshot().variables.trust, 0);
  runtime.choose("refuse");
  assert.equal(runtime.current.id, "no");
  assert.equal(validateProject({ ...p, initialVariables: {} }).valid, false);
});
test("failed automatic traversal rolls back route variable writes as well as playback history", () => {
  const p = {
    ...fixture(),
    nodes: [node("video", "video", { videoUrl: "/video.mp4" }), node("loop", "merge")],
    edges: [
      edge("select", "video", "loop", { choiceLabel: "go", setVariables: { score: 7 } }),
      edge("loop", "loop", "loop"),
    ],
  };
  const runtime = new StoryRuntime(p.nodes, p.edges, "video", { score: 0 });
  assert.throws(() => runtime.choose("select"), /循环/);
  assert.equal(runtime.snapshot().variables.score, 0);
  assert.deepEqual(runtime.history, ["video"]);
});
test("ordinary video voice tracks and clip boundaries survive public snapshot", () => {
  const p = fixture(),
    publicGraph = playbackProject(p),
    runtime = new StoryRuntime(publicGraph.nodes, publicGraph.edges, publicGraph.startNodeId);
  assert.equal(runtime.snapshot().currentAudioUrl, "/voice.mp3");
  assert.equal(runtime.snapshot().currentVideoEnd, 2);
  assert.equal(
    validateProject({
      ...p,
      nodes: [{ ...p.nodes[0], data: { ...p.nodes[0].data, audioUrl: "blob:local" } }, p.nodes[1]],
    }).valid,
    false,
  );
});
test("malformed creation data, typed node fields and reserved variable names are rejected", () => {
  const p = fixture();
  p.creation = {
    activeStep: "story",
    stepStatuses: {},
    userPrompt: "",
    storyOutline: { title: "broken", scenes: null },
    branchDesign: null,
    storyboardShots: [],
    assets: [null],
    assetLibrary: [],
  };
  assert.throws(() => parseProject(p));
  const bad = fixture();
  bad.nodes[0].data.videoUrl = { url: "/bad" };
  assert.throws(() => parseProject(bad));
  assert.throws(() =>
    parseProject({ ...fixture(), initialVariables: JSON.parse('{"__proto__":1}') }),
  );
});
test("image errors and placeholders cannot be treated as completed generation", async () => {
  assert.throws(
    () =>
      generatedImageResult(
        JSON.stringify({
          status: "fallback",
          imageUrl: "https://picsum.photos/a",
          error: "provider failed",
        }),
      ),
    /provider failed/,
  );
  assert.throws(() =>
    generatedImageResult(
      JSON.stringify({ status: "placeholder", imageUrl: "https://picsum.photos/a" }),
    ),
  );
  await assert.rejects(
    generateImageTool.execute(
      { prompt: "test", sceneId: "a" },
      {
        imageProvider: {
          generate: async () => {
            throw Error("unavailable");
          },
        },
      },
    ),
    /unavailable/,
  );
  const long = "https://example.com/" + "a".repeat(800);
  assert.equal(
    generatedImageResult(JSON.stringify({ status: "done", provider: "fal", imageUrl: long })),
    long,
  );
});
test("creation entry points retain prompts and create the appropriate authoring data", () => {
  for (const tool of ["canvas-character", "canvas-scene"]) {
    const p = newProject(tool, "雨中的女孩");
    assert.equal(p.nodes[0].type, "image");
    assert.equal(p.nodes[0].data.prompt, "雨中的女孩");
    assert.equal(p.creation.userPrompt, "雨中的女孩");
  }
  const p = newProject("storyboard", "追逐镜头");
  assert.equal(p.creation.activeStep, "story");
  assert.equal(p.creation.storyOutline, null);
  assert.equal(p.creation.userPrompt, "追逐镜头");
  assert.equal(newProject().nodes.length, 0);
});
test("canvas undo and redo restore graph, variables and creation state after a project replacement", () => {
  canvas.setState(canvas.getInitialState());
  canvas.getState().loadProject(fixture());
  canvas.getState().setInitialVariables({ score: 0 });
  const old = canvas.getState().toProject();
  canvas.getState().replaceProject(newProject("canvas-scene", "新场景"));
  assert.notEqual(canvas.getState().projectId, old.id);
  canvas.getState().undo();
  assert.equal(canvas.getState().projectId, old.id);
  assert.equal(canvas.getState().nodes[0].data.audioUrl, "/voice.mp3");
  assert.deepEqual(canvas.getState().initialVariables, { score: 0 });
  canvas.getState().redo();
  assert.equal(creation.getState().userPrompt, "新场景");
});
test("simultaneous saves reject the stale writer instead of silently overwriting", async () => {
  const p = fixture("revision-test");
  const created = await (await projects.POST(request(p, { "If-Match": "0" }))).json();
  assert.equal(created.revision, 1);
  const results = await Promise.all(
    ["A", "B"].map((name) => projects.POST(request({ ...created, name }, { "If-Match": "1" }))),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const all = await (await projects.GET()).json();
  assert.equal(all.find((p) => p.id === "revision-test").revision, 2);
});
test("publishing tolerates a concurrent UI-only autosave but rejects changed story content", async () => {
  const p = fixture("publication-race");
  const saved = await (await projects.POST(request(p, { "If-Match": "0" }))).json();
  const newer = await (
    await projects.POST(
      request(
        { ...saved, updatedAt: new Date().toISOString() },
        { "If-Match": String(saved.revision) },
      ),
    )
  ).json();
  assert.equal((await publish.POST(request(saved), context(p.id))).status, 201);
  await projects.POST(
    request({ ...newer, name: "changed story" }, { "If-Match": String(newer.revision) }),
  );
  assert.equal((await publish.POST(request(saved), context(p.id))).status, 409);
});
test("uploads persist real media and can be resolved as provider input without localhost URLs", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const form = new FormData();
  form.append("file", new File([png], "角色.png", { type: "image/png" }));
  const response = await assets.POST(
    new Request("http://localhost/api/assets", { method: "POST", body: form }),
  );
  assert.equal(response.status, 201);
  const asset = await response.json();
  assert.equal(asset.type, "image");
  assert.deepEqual((await readGeneratedMedia(asset.id)).bytes, png);
  assert.ok((await providerMediaUrl(asset.url)).startsWith("data:image/png;base64,"));
  assert.ok((await (await assets.GET()).json()).some((a) => a.id === asset.id));
  assert.ok(getDatabase().prepare("SELECT id FROM uploaded_assets WHERE id = ?").get(asset.id));
  const bad = new FormData();
  bad.append("file", new File(["<svg/>"], "bad.svg", { type: "image/svg+xml" }));
  assert.equal(
    (await assets.POST(new Request("http://localhost/api/assets", { method: "POST", body: bad })))
      .status,
    400,
  );
});
test("publication history can recover links and revoke only the requested project version", async () => {
  const p = fixture("publication-history"),
    response = await publish.POST(request(p), context(p.id)),
    publication = await response.json();
  assert.equal(response.status, 201);
  assert.ok(
    (await (await history.GET(new Request("http://localhost"), context(p.id))).json()).some(
      (item) => item.id === publication.id,
    ),
  );
  const url = `http://localhost/api/projects/${p.id}/publications?publicationId=${publication.id}`;
  assert.equal(
    (await history.DELETE(new Request(url, { method: "DELETE" }), context("another"))).status,
    404,
  );
  assert.equal(
    (await history.DELETE(new Request(url, { method: "DELETE" }), context(p.id))).status,
    204,
  );
  assert.equal(
    (await publications.GET(new Request("http://localhost"), context(publication.id))).status,
    404,
  );
});
test("text providers use the model protocol supported by the installed AI SDK", () => {
  assert.equal(require("@ai-sdk/anthropic").anthropic("test").specificationVersion, "v1");
  assert.equal(require("@ai-sdk/openai").openai("test").specificationVersion, "v1");
});
test("queued save acknowledgements update revisions without replacing a different active canvas", async () => {
  const oldStorage = global.localStorage,
    oldFetch = global.fetch,
    saved = new Map(),
    headers = [];
  global.localStorage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  };
  const { cacheProject, saveProject } = load("lib/story/project-cache.ts");
  global.fetch = async (_url, options) => {
    headers.push(options.headers["If-Match"]);
    return Response.json({ ...JSON.parse(options.body), revision: headers.length });
  };
  try {
    const p = fixture("late-save");
    cacheProject(p);
    cacheProject(fixture("active-canvas"));
    await saveProject(p);
    await Promise.all([
      saveProject({ ...p, name: "second" }),
      saveProject({ ...p, name: "third" }),
    ]);
    assert.deepEqual(headers, ["0", "1", "2"]);
    assert.equal(JSON.parse(saved.get("storyreel:canvas")).projectId, "active-canvas");
  } finally {
    global.fetch = oldFetch;
    if (oldStorage === undefined) delete global.localStorage;
    else global.localStorage = oldStorage;
  }
});
test("dragging many frames is one undo step and redo restores the final position", () => {
  canvas.setState(canvas.getInitialState());
  canvas.getState().loadProject(fixture());
  const move = (x, dragging) =>
    canvas
      .getState()
      .onNodesChange(
        canvas
          .getState()
          .nodes.map((n) => (n.id === "video" ? { ...n, position: { x, y: 0 }, dragging } : n)),
      );
  move(0, true);
  move(10, true);
  move(30, true);
  move(60, false);
  assert.equal(canvas.getState().past.length, 1);
  canvas.getState().undo();
  assert.equal(canvas.getState().nodes[0].position.x, 0);
  assert.equal(canvas.getState().dragging, false);
  canvas.getState().redo();
  assert.equal(canvas.getState().nodes[0].position.x, 60);
  move(80, true);
  move(100, false);
  canvas.getState().undo();
  assert.equal(canvas.getState().nodes[0].position.x, 60);
});
test("deleting a node clears an incident selected edge for both deletion paths", () => {
  for (const viaChanges of [false, true]) {
    canvas.setState(canvas.getInitialState());
    canvas.getState().loadProject(fixture());
    canvas.getState().selectEdge("ve");
    if (viaChanges)
      canvas.getState().onNodesChange(canvas.getState().nodes.filter((n) => n.id !== "end"));
    else canvas.getState().deleteNode("end");
    assert.equal(canvas.getState().selectedEdgeId, null);
    assert.equal(canvas.getState().edges.length, 0);
    canvas.getState().undo();
    assert.equal(canvas.getState().edges.length, 1);
    assert.equal(canvas.getState().nodes.length, 2);
  }
});
