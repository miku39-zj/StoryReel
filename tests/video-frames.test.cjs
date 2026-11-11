const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load-ts.cjs");
const { useCanvasStore: store } = load("stores/canvas-store.ts");
const { connectionPortData, resolveVideoInputs, storyEdges } = load("lib/story/connections.ts");
const { generationPlan, generationInput, fingerprint } = load("lib/canvas/workflow.ts");
const { buildSeedanceRequest } = load("lib/ai/seedance-request.ts");
const fixture = () => ({
  id: "frame-flow",
  name: "雨夜的旧钥匙",
  nodes: [
    {
      id: "video",
      type: "video",
      position: { x: 500, y: 200 },
      data: { nodeType: "video", title: "拾起", scenePrompt: "雨夜，林掀起旧钥匙，望向储物柜。" },
    },
  ],
  edges: [],
  startNodeId: "video",
});
beforeEach(() => {
  store.setState(store.getInitialState());
  store.getState().loadProject(fixture());
});

test("frame ports commit and validate explicit context roles; unrelated ports remain compatible", () => {
  assert.deepEqual(connectionPortData("first-frame"), {
    kind: "context",
    inputRole: "first-frame",
  });
  assert.deepEqual(connectionPortData("last-frame"), { kind: "context", inputRole: "last-frame" });
  assert.deepEqual(connectionPortData("context"), { kind: "context" });
  assert.deepEqual(connectionPortData("flow-in"), { kind: "flow" });
});

test("two frame nodes drive one topological production plan, current version inputs and correct provider fields", () => {
  const first = store
    .getState()
    .addConnectedNode("video", "input", "image", { kind: "context", inputRole: "first-frame" });
  const last = store
    .getState()
    .addConnectedNode("video", "input", "image", { kind: "context", inputRole: "last-frame" });
  store.getState().updateNodeData(first, { prompt: "key on the bench" });
  store.getState().updateNodeData(last, { prompt: "key in hand" });
  let p = store.getState().toProject();
  assert.deepEqual(generationPlan(p, ["video"]), [first, last, "video"]);
  assert.equal(resolveVideoInputs("video", p.nodes, p.edges).mode, "first-last-frame");
  assert.throws(() => generationInput(p, "video"), /还没有图片/);
  assert.equal(storyEdges(p.nodes, p.edges).length, 0);
  store.getState().updateNodeData(first, { imageUrl: "https://example.com/f.png" });
  store.getState().updateNodeData(last, { imageUrl: "https://example.com/l.png" });
  p = store.getState().toProject();
  assert.deepEqual(generationPlan(p, ["video"]), ["video"]);
  const before = fingerprint(p, "video"),
    input = generationInput(p, "video"),
    request = buildSeedanceRequest(input);
  assert.equal(input.mode, "first-last-frame");
  assert.equal(request.input.image_url, "https://example.com/f.png");
  assert.equal(request.input.end_image_url, "https://example.com/l.png");
  store.getState().updateNodeData(first, { imageUrl: "https://example.com/f-v2.png" });
  p = store.getState().toProject();
  assert.notEqual(fingerprint(p, "video"), before);
  assert.equal(generationInput(p, "video").firstFrameUrl, "https://example.com/f-v2.png");
  store.getState().loadProject(p);
  assert.equal(
    resolveVideoInputs("video", store.getState().nodes, store.getState().edges).lastFrameUrl,
    "https://example.com/l.png",
  );
});
