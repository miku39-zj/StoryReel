const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load-ts.cjs");
const { initializeCharacterAssets, createSceneFrameInputs } = load("lib/story/character-design.ts");
const { generationInput, fingerprint, generationPlan } = load("lib/canvas/workflow.ts");
const { proposeConnection, resolveImageInputs } = load("lib/story/connections.ts");
const fixture = () => ({
  id: "characters",
  name: "角色故事",
  nodes: [
    {
      id: "video_a",
      type: "video",
      position: { x: 0, y: 0 },
      data: {
        nodeType: "video",
        title: "拾起",
        scenePrompt: "林捡起钥匙",
        videoUrl: "/api/media/existing-video",
      },
    },
  ],
  edges: [],
  creation: {
    storyOutline: {
      characters: [{ name: "林", description: "黑色短发，红色外套" }],
      visualStyle: "anime",
    },
  },
});
test("character cards are reusable nodes, scene frames are independent idempotent inputs", () => {
  const p = initializeCharacterAssets(fixture());
  assert.equal(initializeCharacterAssets(p).nodes.length, p.nodes.length);
  const character = p.nodes.find((n) => n.data.assetKind === "character");
  character.data.imageUrl = "/api/media/character";
  const graph = createSceneFrameInputs(p, "video_a", [character.id]);
  assert.equal(graph.nodes.filter((n) => n.type === "image").length, 3);
  assert.equal(
    graph.nodes.find((n) => n.id === "video_a").data.videoUrl,
    "/api/media/existing-video",
  );
  assert.equal(graph.edges.filter((e) => e.source === character.id).length, 2);
  assert.deepEqual(createSceneFrameInputs(graph, "video_a", [character.id]), graph);
  for (const frame of graph.nodes.filter((n) => n.id.startsWith("video_a_"))) {
    const input = generationInput(graph, frame.id);
    assert.deepEqual(input.referenceImageUrls, ["/api/media/character"]);
    assert.ok(input.prompt.includes("attached character references"));
  }
  const before = fingerprint(graph, "video_a_first-frame");
  character.data.imageUrl = "/api/media/new-character";
  assert.notEqual(fingerprint(graph, "video_a_first-frame"), before);
});
test("image nodes combine upstream text and images, reject video roles and reference cycles", () => {
  const nodes = [
    { id: "text", type: "text", data: { content: "侧面近景" } },
    { id: "ref", type: "image", data: { imageUrl: "/api/media/ref" } },
    { id: "frame", type: "image", data: { prompt: "雨夜" } },
  ];
  const text = proposeConnection("text", "frame", nodes, []),
    image = proposeConnection("ref", "frame", nodes, []);
  assert.equal(image.error, null);
  assert.equal(image.data.inputRole, "reference-image");
  const edges = [
    { id: "text", source: "text", target: "frame", data: text.data },
    { id: "image", source: "ref", target: "frame", data: image.data },
  ];
  const input = resolveImageInputs("frame", nodes, edges);
  assert.ok(input.prompt.includes("侧面近景"));
  assert.ok(input.prompt.includes("雨夜"));
  assert.deepEqual(input.referenceImageUrls, ["/api/media/ref"]);
  assert.ok(proposeConnection("frame", "ref", nodes, edges).error.includes("循环"));
  assert.ok(
    proposeConnection("ref", "frame", nodes, [], { kind: "context", inputRole: "first-frame" })
      .error,
  );
  nodes[1].data.imageUrl = undefined;
  assert.throws(() => resolveImageInputs("frame", nodes, edges), /尚未就绪/);
});
test("generation planning orders character, first/last images, then video without duplicating shared roles", () => {
  const p = initializeCharacterAssets(fixture()),
    character = p.nodes.find((n) => n.data.assetKind === "character");
  const graph = createSceneFrameInputs(p, "video_a", [character.id]);
  assert.deepEqual(generationPlan(graph, ["video_a"]), [
    character.id,
    "video_a_first-frame",
    "video_a_last-frame",
    "video_a",
  ]);
});
test("shot production shares explicit character bindings and invalidates versions when the character changes", () => {
  const { productionShots } = load("lib/production/shot-inputs.ts");
  const { shotRevision } = load("lib/production/shots.ts");
  const p = initializeCharacterAssets(fixture()),
    character = p.nodes.find((n) => n.data.assetKind === "character");
  p.creation.storyboardShots = [
    {
      shotId: "shot",
      sceneId: "a",
      shotIndex: 0,
      frameType: "中景",
      cameraMove: "fixed",
      lighting: "night",
      action: "pick up",
      duration: 5,
      imagePrompt: "rainy station",
    },
  ];
  character.data.imageUrl = "/api/media/character";
  const unbound = productionShots(p)[0];
  assert.equal(unbound.referenceImages, undefined);
  const graph = createSceneFrameInputs(p, "video_a", [character.id]);
  const bound = productionShots(graph)[0];
  assert.equal(bound.referenceImages[0].url, "/api/media/character");
  const revision = shotRevision(bound);
  character.data.assetDescription = "black hair, blue coat";
  assert.notEqual(shotRevision(productionShots(graph)[0]), revision);
  assert.equal(shotRevision(p.creation.storyboardShots[0]), shotRevision(unbound));
});

test("scene references join character references before frames and propagate into shot inputs", () => {
  const { initializeSceneAssets } = load("lib/story/scene-design.ts");
  const p = initializeCharacterAssets(fixture());
  p.creation.storyOutline.scenes = [{ id: "a", title: "雨夜站台" }];
  p.creation.storyboardShots = [
    {
      shotId: "shot_a_0",
      sceneId: "a",
      shotIndex: 0,
      frameType: "近景",
      cameraMove: "fixed",
      lighting: "night",
      action: "拾起",
      duration: 5,
      imagePrompt: "pick up key",
    },
  ];
  const q = initializeSceneAssets(p);
  assert.deepEqual(initializeSceneAssets(q), q);
  const role = q.nodes.find((n) => n.data.assetKind === "character"),
    scene = q.nodes.find((n) => n.data.assetKind === "scene");
  role.data.imageUrl = "/api/media/role";
  scene.data.imageUrl = "/api/media/scene";
  const graph = createSceneFrameInputs(q, "video_a", [role.id], [scene.id]);
  assert.deepEqual(createSceneFrameInputs(graph, "video_a", [role.id], [scene.id]), graph);
  assert.deepEqual(createSceneFrameInputs(graph, "video_a", [role.id]), graph);
  assert.deepEqual(generationInput(graph, "video_a_first-frame").referenceImageUrls, [
    "/api/media/role",
    "/api/media/scene",
  ]);
  const { productionShots } = load("lib/production/shot-inputs.ts");
  assert.equal(productionShots(graph)[0].referenceImages.length, 2);
  assert.equal(
    graph.nodes.find((n) => n.id === "video_a").data.videoUrl,
    "/api/media/existing-video",
  );
});

test("background and frame batches have separate missing work and do not request audio", () => {
  const { missingVisuals } = load("lib/production/visual-plan.ts"),
    { emptyProduction } = load("lib/production/types.ts");
  const p = initializeCharacterAssets(fixture());
  p.nodes.push({
    id: "environment",
    type: "image",
    position: { x: 0, y: 0 },
    data: { nodeType: "image", assetKind: "scene", prompt: "empty environment" },
  });
  p.creation.storyboardShots = [
    {
      shotId: "shot_a_0",
      sceneId: "a",
      shotIndex: 0,
      frameType: "近景",
      cameraMove: "fixed",
      lighting: "night",
      action: "拾起",
      duration: 5,
      imagePrompt: "pick up key",
      dialogue: "hello",
    },
  ];
  const state = emptyProduction(p.id);
  assert.deepEqual(missingVisuals(p, state, "backgrounds"), { images: ["environment"], shots: [] });
  const frames = missingVisuals(p, state, "frames");
  assert.deepEqual(frames.images, []);
  assert.deepEqual(
    frames.shots.map((s) => s.kind),
    ["image"],
  );
});
