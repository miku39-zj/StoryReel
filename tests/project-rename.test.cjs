const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  load = require("./load-ts.cjs");
const { withProjectName, projectNameSchema } = load("lib/story/project-name.ts");
const { fingerprint, isStale } = load("lib/canvas/workflow.ts");
const { canvasResultPatch } = load("lib/generation/results.ts");
const fixture = () => ({
  id: "rename",
  name: "原始项目",
  createdAt: "2026-11-04T00:00:00.000Z",
  updatedAt: "2026-11-04T00:00:00.000Z",
  nodes: [
    {
      id: "video",
      type: "video",
      position: { x: 0, y: 0 },
      data: {
        nodeType: "video",
        title: "拾起",
        scenePrompt: "pick up key",
        videoUrl: "/api/media/kept",
        generationVersions: [{ id: "kept", url: "/api/media/kept" }],
      },
    },
  ],
  edges: [],
  startNodeId: "video",
});
test("rename validates names and preserves generation inputs, versions and pending result applicability", () => {
  let p = fixture();
  const hash = fingerprint(p, "video");
  p.nodes[0].data.generationFingerprint = hash;
  let renamed = withProjectName(p, " 新名称 ");
  assert.equal(renamed.name, "新名称");
  assert.equal(renamed.storyContextTitle, p.name);
  assert.equal(fingerprint(renamed, "video"), hash);
  assert.equal(isStale(renamed, renamed.nodes[0]), false);
  assert.deepEqual(renamed.nodes, p.nodes);
  renamed = withProjectName(renamed, "再改一次");
  assert.equal(fingerprint(renamed, "video"), hash);
  const patch = canvasResultPatch(renamed, {
    id: "new-video",
    projectId: "rename",
    nodeId: "video",
    kind: "video",
    status: "succeeded",
    fingerprint: hash,
    url: "/api/media/new-video",
    previousUrl: "/api/media/kept",
    updatedAt: "now",
  });
  assert.equal(patch.videoUrl, "/api/media/new-video");
  assert.equal(projectNameSchema.safeParse("   ").success, false);
  assert.equal(projectNameSchema.safeParse("a".repeat(501)).success, false);
});
test("name PATCH preserves graph, supports reload and rejects a stale revision or unrelated fields", async () => {
  const { closeDatabases } = load("lib/server/database.ts"),
    { putProject, getProject } = load("lib/server/projects.ts");
  const { PATCH } = load("app/api/projects/[id]/route.ts");
  const previous = process.env.STORYREEL_DATA_DIR,
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "rename-project-"));
  closeDatabases();
  process.env.STORYREEL_DATA_DIR = dir;
  const request = (body) =>
      new Request("http://localhost/api/projects/rename", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    context = { params: Promise.resolve({ id: "rename" }) };
  try {
    const before = await putProject(fixture());
    let response = await PATCH(request({ name: "已改名", revision: before.revision }), context);
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.revision, before.revision + 1);
    assert.deepEqual(saved.nodes, before.nodes);
    assert.deepEqual(saved.edges, before.edges);
    closeDatabases();
    assert.equal((await getProject("rename")).name, "已改名");
    response = await PATCH(request({ name: "覆盖", revision: before.revision }), context);
    assert.equal(response.status, 409);
    assert.equal((await getProject("rename")).name, "已改名");
    for (const body of [
      { name: " ", revision: saved.revision },
      { name: "覆盖", revision: saved.revision, nodes: [] },
      { name: "覆盖" },
    ])
      assert.equal((await PATCH(request(body), context)).status, 400);
    assert.deepEqual((await getProject("rename")).nodes, before.nodes);
  } finally {
    closeDatabases();
    if (previous === undefined) delete process.env.STORYREEL_DATA_DIR;
    else process.env.STORYREEL_DATA_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("editor rename uses the same name semantics and survives undo, redo and reload", () => {
  const { useCanvasStore: store } = load("stores/canvas-store.ts");
  store.setState(store.getInitialState());
  store.getState().loadProject(fixture());
  const hash = fingerprint(store.getState().toProject(), "video");
  store.getState().setProjectName(" 新名称 ");
  assert.equal(store.getState().projectName, "新名称");
  assert.equal(fingerprint(store.getState().toProject(), "video"), hash);
  store.getState().undo();
  assert.equal(store.getState().projectName, "原始项目");
  store.getState().redo();
  const p = store.getState().toProject();
  store.getState().loadProject(p);
  assert.equal(store.getState().projectName, "新名称");
  assert.equal(fingerprint(store.getState().toProject(), "video"), hash);
  store.setState(store.getInitialState());
});
test("dashboard refresh removes deleted server projects while retaining genuinely unsaved local drafts", () => {
  const { mergeProjectLists } = load("lib/story/project-cache.ts");
  const kept = { ...fixture(), revision: 2 },
    removed = { ...fixture(), id: "deleted", revision: 1 },
    draft = { ...fixture(), id: "draft" };
  assert.deepEqual(
    new Set(mergeProjectLists([kept, removed, draft], [kept]).map((p) => p.id)),
    new Set(["rename", "draft"]),
  );
});
