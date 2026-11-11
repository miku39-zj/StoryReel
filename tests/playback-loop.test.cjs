const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load-ts.cjs");
const { StoryRuntime } = load("lib/story/runtime.ts");
const { validateProject, allPaths, playbackProject } = load("lib/story/graph.ts");
const { applyBranchDesign } = load("lib/story/apply-branches.ts");
const { usePlayerStore: player } = load("stores/player-store.ts");
const { useCanvasStore: canvas } = load("stores/canvas-store.ts");
const { useCreationStore: creation } = load("stores/creation-store.ts");
const node = (id, type = "video", data = {}) => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: {
    nodeType: type,
    title: id,
    ...(type === "video" ? { videoUrl: "https://example.com/shared.mp4" } : {}),
    ...data,
  },
});
const edge = (id, source, target, data = {}) => ({
  id,
  source,
  target,
  data: { kind: "flow", ...data },
});
const project = (nodes, edges, startNodeId = nodes[0]?.id) => ({
  id: "loop-test",
  name: "story",
  nodes,
  edges,
  startNodeId,
  createdAt: "2026-10-29T00:00:00.000Z",
  updatedAt: "2026-10-29T00:00:00.000Z",
});
beforeEach(() => {
  player.getState().destroy();
  canvas.setState(canvas.getInitialState());
});

test("single continuations advance automatically, wait at decisions, and end explicitly", () => {
  const nodes = [
    node("a"),
    node("b"),
    node("c", "choice", { question: "Open the letter?", timeoutSecs: 4 }),
    node("d"),
    node("end", "ending"),
  ];
  const edges = [
    edge("ab", "a", "b"),
    edge("bc", "b", "c"),
    edge("yes", "c", "d", { choiceLabel: "Yes" }),
    edge("no", "c", "end", { choiceLabel: "No" }),
    edge("de", "d", "end"),
  ];
  player.getState().init(nodes, edges, "a");
  let revision = player.getState().revision;
  player.getState().onInteractionPoint(revision);
  assert.equal(player.getState().currentNodeId, "b");
  assert.equal(player.getState().phase, "playing");
  assert.notEqual(player.getState().revision, revision); // same video URL still reloads
  player.getState().onInteractionPoint(revision); // late ended event from a must not skip b
  assert.equal(player.getState().currentNodeId, "b");
  player.getState().onInteractionPoint();
  assert.equal(player.getState().phase, "awaiting");
  assert.equal(player.getState().question, "Open the letter?");
  assert.equal(player.getState().timeoutSecs, 4);
  player.getState().choose("yes");
  assert.equal(player.getState().currentNodeId, "d");
  player.getState().choose("no"); // double click after leaving a decision is ignored
  assert.equal(player.getState().currentNodeId, "d");
  player.getState().onInteractionPoint();
  assert.equal(player.getState().phase, "ended");
  assert.deepEqual(player.getState().history, ["a", "b", "c", "d", "end"]);
  player.getState().reset();
  assert.equal(player.getState().ending, null);
  assert.deepEqual(player.getState().history, ["a"]);
});

test("automatic cycles fail safely without stack overflow or partially mutated traversal", () => {
  const nodes = [node("a"), node("m", "merge"), node("n", "merge")];
  const edges = [edge("am", "a", "m"), edge("mn", "m", "n"), edge("nm", "n", "m")];
  const runtime = new StoryRuntime(nodes, edges, "a");
  assert.throws(() => runtime.advance(), /循环/);
  assert.equal(runtime.current.id, "a");
  assert.deepEqual(runtime.history, ["a"]);
  player.getState().init(nodes, edges, "a");
  player.getState().onInteractionPoint();
  assert.equal(player.getState().phase, "error");
  assert.match(player.getState().error, /循环/);
});

test("conditions and merges resolve deterministically and material links are ignored", () => {
  const nodes = [
    node("a"),
    node("cond", "condition", { variable: "trust", operator: ">=", value: 2 }),
    node("merge", "merge"),
    node("end", "ending"),
    node("other", "ending"),
    node("ref"),
  ];
  const edges = [
    edge("ac", "a", "cond"),
    edge("t", "cond", "merge", { condition: "true" }),
    edge("f", "cond", "other", { condition: "false" }),
    edge("me", "merge", "end"),
    edge("ref", "a", "ref", { kind: "context", inputRole: "reference-video" }),
  ];
  const r = new StoryRuntime(nodes, edges, "a");
  r.setVariable("trust", 3);
  assert.equal(r.advance().id, "end");
  assert.deepEqual(r.history, ["a", "cond", "merge", "end"]);
  assert.equal(
    validateProject({ ...project(nodes, edges), initialVariables: { trust: 0 } }).valid,
    true,
  );
});

test("publication rejects missing videos, nonportable URLs, dead ends, malformed decisions and loops", () => {
  for (const url of [undefined, "blob:local", "file:///tmp/a.mp4", "javascript:alert(1)"]) {
    const p = project(
      [node("v", "video", { videoUrl: url }), node("end", "ending")],
      [edge("ve", "v", "end")],
    );
    assert.equal(validateProject(p).valid, false);
  }
  const dead = project([node("v")], []);
  assert.equal(validateProject(dead).valid, false);
  assert.equal(validateProject(dead).allPathsReachEnding, false);
  assert.equal(allPaths(dead)[0].ending, null);
  const cycle = project(
    [node("v"), node("end", "ending")],
    [edge("vv", "v", "v"), edge("ve", "v", "end", { choiceLabel: "exit" })],
  );
  assert.equal(validateProject(cycle).valid, false);
  const malformed = project(
    [node("v"), node("c", "choice"), node("end", "ending")],
    [edge("vc", "v", "c"), edge("ce", "c", "end")],
  );
  assert.equal(validateProject(malformed).valid, false);
});

test("validation scales with shared branches and excludes unreachable source assets", () => {
  const nodes = [node("start"), node("end", "ending"), node("ref")];
  const edges = [edge("r", "ref", "start", { kind: "context", inputRole: "reference-video" })];
  let last = "start";
  for (let i = 0; i < 80; i++) {
    const a = `a${i}`,
      b = `b${i}`,
      m = `m${i}`;
    nodes.push(node(a), node(b), node(m, "merge"));
    edges.push(
      edge(`l${i}`, last, a, { choiceLabel: "A" }),
      edge(`r${i}`, last, b, { choiceLabel: "B" }),
      edge(`a${i}`, a, m),
      edge(`b${i}`, b, m),
    );
    last = m;
    // A merge must have only one outgoing edge: put a new video before the next split.
    const v = `v${i}`;
    nodes.push(node(v));
    edges.push(edge(`mv${i}`, m, v));
    last = v;
  }
  edges.push(edge("finish", last, "end"));
  const p = project(nodes, edges, "start");
  const result = validateProject(p);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.assetsTotal, 241);
  const publicGraph = playbackProject({ ...p, creation: { secret: "private" } });
  assert.equal(publicGraph.creation, undefined);
  assert.equal(
    publicGraph.nodes.some((n) => n.id === "ref"),
    false,
  );
  assert.equal(
    publicGraph.edges.some((e) => e.id === "r"),
    false,
  );
});

test("branch application is atomic and repeatable, preserves videos and replaces questions/endings", () => {
  const scenes = ["a", "b", "c"].map((id, order) => ({
    id,
    title: id,
    description: "",
    scenePrompt: "prompt",
    order,
  }));
  const outline = { title: "story", scenes };
  const original = project(
    [
      node("video_a"),
      node("video_b"),
      node("video_c"),
      node("source", "image", { imageUrl: "https://example.com/image.png" }),
    ],
    [edge("input", "source", "video_a", { kind: "context", inputRole: "first-frame" })],
    "video_a",
  );
  const design = {
    decisionPoints: [
      {
        sceneId: "a",
        question: "Which way?",
        choices: [
          { label: "left", targetSceneId: "b", consequence: "" },
          { label: "right", targetSceneId: "c", consequence: "" },
        ],
      },
    ],
    endings: [
      { sceneId: "b", title: "Left ending", description: "" },
      { sceneId: "c", title: "Right ending", description: "" },
    ],
  };
  const applied = applyBranchDesign(original, outline, design);
  const repeated = applyBranchDesign(applied, outline, design);
  assert.deepEqual(repeated.nodes, applied.nodes);
  assert.deepEqual(repeated.edges, applied.edges);
  assert.equal(applied.nodes.find((n) => n.id === "choice_a").data.question, "Which way?");
  assert.equal(applied.nodes.find((n) => n.id === "ending_b").data.title, "Left ending");
  assert.equal(
    applied.nodes.find((n) => n.id === "video_a").data.videoUrl,
    "https://example.com/shared.mp4",
  );
  assert.ok(applied.edges.find((e) => e.id === "input"));
  assert.equal(validateProject(applied).valid, true);
  const broken = structuredClone(design);
  broken.decisionPoints[0].choices[0].targetSceneId = "missing";
  assert.throws(() => applyBranchDesign(original, outline, broken), /不存在/);
  assert.equal(original.nodes.length, 4);
});

test("per-project cache, creation data and creation timestamps survive reopen without stale dashboard overwrite", () => {
  const oldWindow = global.window,
    oldStorage = global.localStorage;
  const memory = new Map();
  global.window = {};
  global.localStorage = {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => memory.set(k, v),
  };
  try {
    canvas.getState().loadProject(project([node("a")], []));
    creation.getState().setUserPrompt("saved outline");
    canvas.getState().updateNodeData("a", { title: "edited title" });
    const createdAt = canvas.getState().toProject().createdAt;
    canvas.getState().loadProject({ ...project([node("b")], []), id: "another" });
    canvas.getState().hydrate("loop-test");
    assert.equal(canvas.getState().nodes[0].data.title, "edited title");
    assert.equal(creation.getState().userPrompt, "saved outline");
    assert.equal(canvas.getState().toProject().createdAt, createdAt);
    assert.equal(
      JSON.parse(memory.get("storyreel:projects")).find((p) => p.id === "loop-test").nodes[0].data
        .title,
      "edited title",
    );
  } finally {
    if (oldWindow === undefined) delete global.window;
    else global.window = oldWindow;
    if (oldStorage === undefined) delete global.localStorage;
    else global.localStorage = oldStorage;
  }
});
