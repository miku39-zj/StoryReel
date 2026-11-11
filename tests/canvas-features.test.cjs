const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load-ts.cjs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { copyFragment, pasteFragment, layoutGraph, reviewStory } = load("lib/canvas/editing.ts");
const { canvasQuote } = load("lib/server/canvas-policy.ts");
const { generationInput, fingerprint } = load("lib/canvas/workflow.ts");
const { putProject, getProject, projectHistory, restoreProjectRevision, ProjectConflict } =
  load("lib/server/projects.ts");
const { closeDatabases } = load("lib/server/database.ts");
const n = (id, type, data = {}) => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { nodeType: type, title: id, ...data },
});
const e = (id, source, target, data = {}) => ({ id, source, target, data });
const p = () => ({
  id: "feature",
  name: "story",
  nodes: [],
  edges: [],
  createdAt: "2026-10-31T00:00:00.000Z",
  updatedAt: "2026-10-31T00:00:00.000Z",
});
test("copy includes only internal edges and paste remaps IDs without mutating originals", () => {
  const project = {
    ...p(),
    nodes: [
      n("a", "image", { generationJobId: "old", imageUrl: "/image.png" }),
      n("b", "video"),
      n("c", "ending"),
    ],
    edges: [
      e("ab", "a", "b", { kind: "context", inputRole: "reference-image" }),
      e("bc", "b", "c"),
    ],
  };
  const fragment = copyFragment(project, ["a", "b"]);
  const pasted = pasteFragment(fragment);
  assert.equal(pasted.edges.length, 1);
  assert.equal(pasted.edges[0].source, pasted.nodes[0].id);
  assert.equal(pasted.edges[0].target, pasted.nodes[1].id);
  assert.notEqual(pasted.nodes[0].id, "a");
  assert.equal(pasted.nodes[0].data.generationJobId, undefined);
  assert.equal(pasted.nodes[0].data.imageUrl, "/image.png");
  assert.equal(project.nodes[0].data.generationJobId, "old");
  assert.equal(project.nodes[0].position.x, 0);
});
test("layout separates layers and handles cycles without losing nodes or edges", () => {
  const nodes = [
      n("a", "video"),
      n("b", "choice"),
      n("c", "ending"),
      n("d", "video"),
      n("e", "video"),
    ],
    edges = [e("ab", "a", "b"), e("bc", "b", "c"), e("de", "d", "e"), e("ed", "e", "d")];
  const placed = layoutGraph(nodes, edges);
  assert.ok(placed[0].position.x < placed[1].position.x);
  assert.ok(placed[1].position.x < placed[2].position.x);
  assert.equal(placed.length, 5);
  assert.notDeepEqual(placed[3].position, placed[4].position);
});
test("local review flags duplicate choices and no-op decisions without model calls", () => {
  const project = {
    ...p(),
    nodes: [n("c", "choice", { question: "Pick" }), n("end", "ending")],
    edges: [
      e("a", "c", "end", { choiceLabel: "Same" }),
      e("b", "c", "end", { choiceLabel: "Same" }),
    ],
  };
  assert.equal(reviewStory(project).length, 3);
});
test("quote includes upstream work, enforces limits and does not invent prices", () => {
  const project = {
    ...p(),
    nodes: [n("i", "image", { prompt: "portrait" }), n("v", "video", { scenePrompt: "action" })],
    edges: [e("iv", "i", "v", { kind: "context", inputRole: "reference-image" })],
  };
  const before = process.env.STORYREEL_MAX_BATCH;
  try {
    delete process.env.STORYREEL_MAX_BATCH;
    const q = canvasQuote(project, ["v"]);
    assert.equal(q.total, 2);
    assert.equal(q.images, 1);
    assert.equal(q.videos, 1);
    assert.equal(q.estimatedCny, null);
    process.env.STORYREEL_MAX_BATCH = "1";
    assert.throws(() => canvasQuote(project, ["v"]), /上限/);
  } finally {
    if (before === undefined) delete process.env.STORYREEL_MAX_BATCH;
    else process.env.STORYREEL_MAX_BATCH = before;
  }
});
test("reused character references contribute identity and changes invalidate video; groups do not", () => {
  const project = {
    ...p(),
    nodes: [
      n("i", "image", { assetKind: "character", assetDescription: "red coat", imageUrl: "/a.png" }),
      n("v", "video", { scenePrompt: "walking" }),
    ],
    edges: [e("iv", "i", "v", { kind: "context", inputRole: "reference-image" })],
  };
  assert.match(generationInput(project, "v").prompt, /red coat/);
  const hash = fingerprint(project, "v");
  project.nodes[1].data.groupLabel = "scene 1";
  assert.equal(fingerprint(project, "v"), hash);
  project.nodes[0].data.assetDescription = "blue coat";
  assert.notEqual(fingerprint(project, "v"), hash);
});
test("historical restore creates a new revision, preserves current work and rejects conflicts", async () => {
  closeDatabases();
  const old = process.env.STORYREEL_DATA_DIR,
    root = await fs.mkdtemp(path.join(os.tmpdir(), "project-history-"));
  process.env.STORYREEL_DATA_DIR = root;
  try {
    let project = await putProject(p(), 0);
    project = await putProject({ ...project, name: "second" }, 1);
    assert.equal(projectHistory(project.id)[0].revision, 1);
    const restored = await restoreProjectRevision(project.id, 1, 2);
    assert.equal(restored.name, "story");
    assert.equal(restored.revision, 3);
    assert.ok(projectHistory(project.id).some((v) => v.name === "second"));
    await assert.rejects(() => restoreProjectRevision(project.id, 1, 2), ProjectConflict);
    assert.equal((await getProject(project.id)).revision, 3);
  } finally {
    closeDatabases();
    if (old === undefined) delete process.env.STORYREEL_DATA_DIR;
    else process.env.STORYREEL_DATA_DIR = old;
    await fs.rm(root, { recursive: true, force: true });
  }
});
