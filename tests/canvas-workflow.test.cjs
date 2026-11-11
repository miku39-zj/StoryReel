const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load-ts.cjs");
const { fingerprint, isStale, generationPlan, generationInput } = load("lib/canvas/workflow.ts");
const { StoryRuntime } = load("lib/story/runtime.ts");
const { playbackProject, validateProject } = load("lib/story/graph.ts");
const { parseProject } = load("lib/story/project-schema.ts");
const node = (id, type, data = {}) => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { nodeType: type, title: id, ...data },
});
const edge = (id, source, target, data = {}) => ({ id, source, target, data });
const fixture = () => ({
  id: "canvas-test",
  name: "story",
  createdAt: "2026-10-30T00:00:00.000Z",
  updatedAt: "2026-10-30T00:00:00.000Z",
  nodes: [
    node("t", "text", { content: "a detective" }),
    node("i", "image", { prompt: "portrait" }),
    node("v", "video", { scenePrompt: "opens a letter" }),
  ],
  edges: [
    edge("ti", "t", "i", { kind: "context", inputRole: "prompt" }),
    edge("iv", "i", "v", { kind: "context", inputRole: "first-frame" }),
  ],
});
test("dependency planning is topological and shared inputs generate once", () => {
  const p = fixture();
  assert.deepEqual(generationPlan(p, ["v", "i"]), ["i", "v"]);
  p.edges.push(edge("loop", "v", "i", { kind: "context" }));
  assert.throws(() => generationPlan(p, ["v"]), /循环/);
});
test("upstream edits, connection removal, and story changes invalidate downstream results but layout/status do not", () => {
  const p = fixture();
  p.nodes[1].data.imageUrl = "/api/media/a";
  const v = p.nodes[2];
  v.data.videoUrl = "/api/media/v";
  v.data.generationFingerprint = fingerprint(p, "v");
  assert.equal(isStale(p, v), false);
  p.nodes[0].position.x = 100;
  p.nodes[1].data.generationStatus = "done";
  assert.equal(isStale(p, v), false);
  p.nodes[0].data.content = "a different character";
  assert.equal(isStale(p, v), true);
  v.data.generationFingerprint = fingerprint(p, "v");
  p.edges.pop();
  assert.equal(isStale(p, v), true);
});
test("generation input uses actual references and labelled predecessor context", () => {
  const p = fixture();
  p.nodes[1].data.imageUrl = "/api/media/a";
  p.nodes.push(node("before", "video", { description: "previous scene" }));
  p.edges.push(edge("route", "before", "v", { kind: "flow", choiceLabel: "open" }));
  const input = generationInput(p, "v");
  assert.equal(input.firstFrameUrl, "/api/media/a");
  assert.match(input.prompt, /previous scene/);
  assert.match(input.prompt, /互斥/);
  assert.match(input.prompt, /opens a letter/);
});
test("variable operations, combined conditions, public serialization and debug reasons agree", () => {
  const p = {
    ...fixture(),
    startNodeId: "v",
    initialVariables: { trust: 1, clue: false },
    nodes: [
      node("v", "video", { videoUrl: "/a.mp4" }),
      node("c", "condition", {
        conditionMode: "all",
        conditions: [
          { variable: "trust", operator: ">=", value: 3 },
          { variable: "clue", operator: "==", value: true },
        ],
      }),
      node("yes", "ending"),
      node("no", "ending"),
    ],
    edges: [
      edge("vc", "v", "c", {
        variableOperations: [
          { variable: "trust", operation: "add", value: 2 },
          { variable: "clue", operation: "toggle" },
        ],
      }),
      edge("cy", "c", "yes", { condition: "true" }),
      edge("cn", "c", "no", { condition: "false" }),
    ],
  };
  assert.equal(validateProject(p).valid, true);
  const published = parseProject(playbackProject(p));
  const runtime = new StoryRuntime(published.nodes, published.edges, "v", p.initialVariables);
  runtime.advance();
  assert.equal(runtime.current.id, "yes");
  assert.deepEqual(runtime.snapshot().variables, { trust: 3, clue: true });
  assert.ok(runtime.snapshot().trace.some((t) => t.message.includes("trust(3)")));
  runtime.reset();
  assert.deepEqual(runtime.snapshot().variables, p.initialVariables);
});
test("failed automatic traversal rolls back variables and traces", () => {
  const nodes = [
      node("v", "video"),
      node("c", "condition", { variable: "unknown", operator: "==", value: 1 }),
    ],
    edges = [
      edge("e", "v", "c", {
        variableOperations: [{ variable: "score", operation: "add", value: 1 }],
      }),
    ];
  const r = new StoryRuntime(nodes, edges, "v", { score: 0 });
  assert.throws(() => r.advance());
  assert.equal(r.snapshot().variables.score, 0);
  assert.equal(r.snapshot().trace.length, 0);
  assert.equal(r.current.id, "v");
});
module.exports = { fixture };
test("late generation result is kept as history without replacing edited inputs or manually selected media", async () => {
  const { useCanvasStore: store } = load("stores/canvas-store.ts");
  const { useCanvasJobs: jobs } = load("stores/canvas-jobs-store.ts");
  const oldFetch = global.fetch;
  try {
    store.getState().loadProject(fixture());
    const project = store.getState().toProject(),
      hash = fingerprint(project, "i");
    store.getState().updateNodeData("i", { imageUrl: "/manual.png" });
    global.fetch = async () =>
      Response.json({
        jobs: [
          {
            id: "late",
            projectId: project.id,
            nodeId: "i",
            kind: "image",
            status: "succeeded",
            url: "/generated.png",
            fingerprint: hash,
            updatedAt: "2026-10-31T00:00:00.000Z",
            dependencies: [],
          },
        ],
      });
    await jobs.getState().refresh();
    let image = store.getState().nodes.find((n) => n.id === "i");
    assert.equal(image.data.imageUrl, "/manual.png");
    assert.equal(image.data.generationVersions.length, 1);
    await jobs.getState().refresh();
    assert.equal(
      store.getState().nodes.find((n) => n.id === "i").data.generationVersions.length,
      1,
    );
  } finally {
    global.fetch = oldFetch;
  }
});
test("legacy media acquires a stable baseline when loaded and detects subsequent prompt changes", () => {
  const { useCanvasStore: store } = load("stores/canvas-store.ts");
  const p = fixture();
  p.nodes[1].data.imageUrl = "/imported.png";
  store.getState().loadProject(p);
  let project = store.getState().toProject();
  assert.equal(isStale(project, project.nodes[1]), false);
  store.getState().updateNodeData("t", { content: "changed" });
  project = store.getState().toProject();
  assert.equal(isStale(project, project.nodes[1]), true);
});
