const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load-ts.cjs");
const { proposeConnection, resolveVideoInputs, resolvePrompt, storyEdges } = load(
  "lib/story/connections.ts",
);
const { StoryRuntime } = load("lib/story/runtime.ts");
const { validateProject, allPaths } = load("lib/story/graph.ts");
const { useCanvasStore: store } = load("stores/canvas-store.ts");
const node = (id, type, data = {}) => ({
  id,
  type,
  data: { nodeType: type, title: id, ...data },
  position: { x: 0, y: 0 },
});
const edge = (id, source, target, role) => ({
  id,
  source,
  target,
  data: role ? { kind: "context", inputRole: role } : { kind: "flow" },
});

beforeEach(() => store.setState(store.getInitialState()));

test("editing the complete video prompt replaces text inputs without duplicating or changing shared text", () => {
  const nodes = [
    node("text", "text", { content: "original direction" }),
    node("frame", "image", { imageUrl: "https://example.com/frame.png" }),
    node("video", "video", { scenePrompt: "camera move" }),
    node("other", "video"),
  ];
  const edges = [
    edge("prompt", "text", "video", "prompt"),
    edge("frame", "frame", "video", "first-frame"),
    edge("shared", "text", "other", "prompt"),
  ];
  store.setState({ projectId: "prompt-editor", nodes, edges });
  const before = resolveVideoInputs("video", nodes, edges).prompt;
  assert.equal(before, "original direction\n\ncamera move");
  const edited = "edited direction\n\nnew camera move \n";
  store.getState().setVideoPrompt("video", edited);
  let state = store.getState();
  assert.equal(state.nodes.find((n) => n.id === "video").data.scenePrompt, edited);
  assert.equal(resolveVideoInputs("video", state.nodes, state.edges).prompt, edited.trim());
  assert.equal(
    resolveVideoInputs("video", state.nodes, state.edges).firstFrameUrl,
    nodes[1].data.imageUrl,
  );
  assert.equal(resolveVideoInputs("other", state.nodes, state.edges).prompt, "original direction");
  assert.deepEqual(
    state.edges.map((e) => e.id),
    ["frame", "shared"],
  );
  state.undo();
  state = store.getState();
  assert.equal(resolveVideoInputs("video", state.nodes, state.edges).prompt, before);
  state.redo();
  state = store.getState();
  assert.equal(resolveVideoInputs("video", state.nodes, state.edges).prompt, edited.trim());
});

test("text and multiple image/video inputs resolve from current upstream values", () => {
  const nodes = [
    node("text", "text", { content: "original" }),
    node("img", "image", { imageUrl: "https://example.com/a.png" }),
    node("ref", "video", { videoUrl: "https://example.com/r.mp4" }),
    node("out", "video", { scenePrompt: "extra" }),
  ];
  const edges = [
    edge("p", "text", "out", "prompt"),
    edge("i", "img", "out", "reference-image"),
    edge("v", "ref", "out", "reference-video"),
  ];
  let inputs = resolveVideoInputs("out", nodes, edges);
  assert.equal(inputs.prompt, "original\n\nextra");
  assert.equal(inputs.mode, "reference-to-video");
  assert.equal(inputs.model, "seedance-2-0");
  assert.deepEqual(inputs.referenceImageUrls, ["https://example.com/a.png"]);
  assert.deepEqual(inputs.referenceVideoUrls, ["https://example.com/r.mp4"]);
  nodes[0].data.content = "edited";
  nodes[1].data.imageUrl = "https://example.com/new.png";
  inputs = resolveVideoInputs("out", nodes, edges);
  assert.equal(inputs.prompt, "edited\n\nextra");
  assert.equal(inputs.referenceImageUrls[0], "https://example.com/new.png");
  assert.deepEqual(
    resolveVideoInputs(
      "out",
      nodes,
      edges.filter((e) => e.id !== "i"),
    ).referenceImageUrls,
    [],
  );
  assert.equal(resolvePrompt("out", nodes, edges), "edited");
});

test("frames stay separate, missing assets block generation and mixed modes are explicit", () => {
  const nodes = [
    node("first", "image", { imageUrl: "https://example.com/f.png" }),
    node("last", "image", { imageUrl: "https://example.com/l.png" }),
    node("ref", "image"),
    node("out", "video"),
  ];
  const edges = [edge("f", "first", "out", "first-frame"), edge("l", "last", "out", "last-frame")];
  const inputs = resolveVideoInputs("out", nodes, edges);
  assert.equal(inputs.mode, "first-last-frame");
  assert.equal(inputs.firstFrameUrl, nodes[0].data.imageUrl);
  assert.equal(inputs.lastFrameUrl, nodes[1].data.imageUrl);
  const mixed = resolveVideoInputs("out", nodes, [
    ...edges,
    edge("r", "ref", "out", "reference-image"),
  ]);
  assert.ok(mixed.errors.some((e) => e.includes("还没有图片")));
  assert.ok(mixed.errors.some((e) => e.includes("不能混用")));
});

test("duplicate, self, mismatched, cyclic and duplicate frame connections are rejected", () => {
  const nodes = [
    node("a", "video"),
    node("b", "video"),
    node("i", "image"),
    node("j", "image"),
    node("t", "text"),
    node("end", "ending"),
  ];
  const edges = [edge("r", "a", "b", "reference-video"), edge("f", "i", "b", "first-frame")];
  assert.ok(proposeConnection("a", "a", nodes, edges).error);
  assert.ok(proposeConnection("b", "a", nodes, edges, { kind: "context" }).error);
  assert.ok(
    proposeConnection("j", "b", nodes, edges, { kind: "context", inputRole: "first-frame" }).error,
  );
  assert.ok(proposeConnection("t", "end", nodes, edges).error);
  assert.ok(proposeConnection("a", "b", nodes, edges, { kind: "context" }).error);
  assert.equal(proposeConnection("b", "a", nodes, edges, { kind: "flow" }).error, null);
});

test("asset connections never become playback paths or false orphan warnings", () => {
  const nodes = [
    node("text", "text"),
    node("image", "image"),
    node("ref", "video"),
    node("start", "video"),
    node("end", "ending"),
  ];
  const edges = [
    edge("p", "text", "start", "prompt"),
    edge("i", "image", "start", "reference-image"),
    edge("r", "ref", "start", "reference-video"),
    edge("next", "start", "end"),
  ];
  const project = { id: "p", name: "story", nodes, edges, startNodeId: "start" };
  assert.equal(storyEdges(nodes, edges).length, 1);
  assert.deepEqual(
    new StoryRuntime(nodes, edges, "start").getChoices().map((c) => c.edgeId),
    ["next"],
  );
  assert.deepEqual(allPaths(project), [{ path: ["start", "end"], ending: "end" }]);
  assert.ok(
    !validateProject(project).warnings.some((w) => w.includes('"text"') || w.includes('"image"')),
  );
});

test("connected node creation is atomic, persists input roles, and text/image are not playback starts", () => {
  const text = store.getState().addNode("text", { x: 100, y: 100 });
  assert.equal(store.getState().startNodeId, null);
  const video = store
    .getState()
    .addConnectedNode(text, "output", "video", { kind: "context", inputRole: "prompt" });
  assert.ok(video);
  assert.equal(store.getState().startNodeId, video);
  const image = store
    .getState()
    .addConnectedNode(video, "input", "image", { kind: "context", inputRole: "first-frame" });
  assert.ok(image);
  const before = store.getState().nodes.length;
  assert.equal(
    store
      .getState()
      .addConnectedNode(video, "input", "image", { kind: "context", inputRole: "first-frame" }),
    null,
  );
  assert.equal(store.getState().nodes.length, before);
  store.getState().setStartNode(text);
  assert.equal(store.getState().startNodeId, video);
  const input = store.getState().edges.find((e) => e.source === image);
  assert.equal(input.data.inputRole, "first-frame");
  store.getState().deleteNode(image);
  assert.ok(!store.getState().edges.some((e) => e.source === image));
});

test("persisted input roles and values survive reload", () => {
  const previousWindow = global.window,
    previousStorage = global.localStorage;
  const saved = new Map();
  global.window = {};
  global.localStorage = {
    setItem: (key, value) => saved.set(key, value),
    getItem: (key) => saved.get(key),
  };
  try {
    const text = store.getState().addNode("text", { x: 0, y: 0 });
    store.getState().updateNodeData(text, { content: "persisted prompt" });
    const video = store
      .getState()
      .addConnectedNode(text, "output", "video", { kind: "context", inputRole: "prompt" });
    store.setState({ nodes: [], edges: [], startNodeId: null });
    store.getState().hydrate();
    assert.equal(
      resolveVideoInputs(video, store.getState().nodes, store.getState().edges).prompt,
      "persisted prompt",
    );
    assert.equal(store.getState().edges[0].data.kind, "context");
    assert.equal(store.getState().startNodeId, video);
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousStorage === undefined) delete global.localStorage;
    else global.localStorage = previousStorage;
  }
});

test("legacy image links are migrated once, then keep their role when the source URL changes", () => {
  store.getState().loadProject({
    id: "legacy",
    name: "legacy",
    nodes: [
      node("i", "image", { imageUrl: "https://example.com/old.png" }),
      node("v", "video", { firstFrameUrl: "https://example.com/old.png" }),
    ],
    edges: [{ id: "old", source: "i", target: "v" }],
    startNodeId: "v",
  });
  assert.equal(store.getState().edges[0].data.inputRole, "first-frame");
  store.getState().updateNodeData("i", { imageUrl: "https://example.com/new.png" });
  const inputs = resolveVideoInputs("v", store.getState().nodes, store.getState().edges);
  assert.equal(inputs.firstFrameUrl, "https://example.com/new.png");
  assert.equal(inputs.mode, "image-to-video");
});

test("distinct story choices may still lead to the same scene", () => {
  const nodes = [node("c", "choice"), node("v", "video")];
  const edges = [{ id: "a", source: "c", target: "v", data: { kind: "flow", choiceLabel: "A" } }];
  assert.equal(proposeConnection("c", "v", nodes, edges, { choiceLabel: "B" }).error, null);
  assert.ok(proposeConnection("c", "v", nodes, edges, { choiceLabel: "A" }).error);
});

test("adding a reference video does not make the reference the playback start", () => {
  store.setState({ nodes: [node("target", "video")], edges: [], startNodeId: null });
  const source = store.getState().addConnectedNode("target", "input", "video", {
    kind: "context",
    inputRole: "reference-video",
  });
  assert.ok(source);
  assert.equal(store.getState().startNodeId, "target");
});

test("canvas keyboard deletion removes material links and clears stale selection", () => {
  const text = store.getState().addNode("text", { x: 0, y: 0 });
  const video = store
    .getState()
    .addConnectedNode(text, "output", "video", { kind: "context", inputRole: "prompt" });
  const edge = store.getState().edges[0];
  store.getState().selectEdge(edge.id);
  store.getState().onEdgesChange([]);
  assert.equal(store.getState().selectedEdgeId, null);
  store.getState().addEdge(text, video, { kind: "context", inputRole: "prompt" });
  store.getState().selectNode(text);
  store.getState().onNodesChange(store.getState().nodes.filter((n) => n.id !== text));
  assert.equal(store.getState().edges.length, 0);
  assert.equal(store.getState().selectedNodeId, null);
  store.getState().onNodesChange([]);
  assert.equal(store.getState().startNodeId, null);
});
