const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load-ts.cjs");
const { productionShots } = load("lib/production/shot-inputs.ts");
const { normalizeShots, shotRevision } = load("lib/production/shots.ts");
const shot = (id, ids) => ({
  shotId: id,
  sceneId: "a",
  shotIndex: id === "one" ? 0 : 1,
  frameType: "中景",
  cameraMove: "fixed",
  lighting: "night",
  action: "talk",
  duration: 5,
  imagePrompt: "station",
  referenceNodeIds: ids,
});
const node = (id, kind) => ({
  id,
  type: "image",
  position: { x: 0, y: 0 },
  data: { nodeType: "image", assetKind: kind, title: id, imageUrl: `/api/media/${id}` },
});
const fixture = () => ({
  id: "refs",
  name: "refs",
  edges: [],
  nodes: [node("alice", "character"), node("bob", "character"), node("station", "scene")],
  creation: { storyboardShots: [shot("one", ["alice", "station"]), shot("two", ["bob"])] },
});
test("shots in the same scene resolve independent role and environment image inputs", () => {
  const p = fixture();
  const result = productionShots(p);
  assert.deepEqual(
    result[0].referenceImages.map((r) => r.url),
    ["/api/media/alice", "/api/media/station"],
  );
  assert.deepEqual(
    result[1].referenceImages.map((r) => r.nodeId),
    ["bob"],
  );
  const revision = shotRevision(result[0]);
  p.nodes[2].data.imageUrl = "/api/media/station-v2";
  assert.notEqual(shotRevision(productionShots(p)[0]), revision);
  assert.equal(shotRevision(productionShots(p)[1]), shotRevision(result[1]));
});
test("explicit clear stays clear and deleted references remain visible as missing inputs", () => {
  const p = fixture();
  p.creation.storyboardShots[0].referenceNodeIds = [];
  assert.deepEqual(productionShots(p)[0].referenceImages, []);
  p.nodes = p.nodes.filter((node) => node.id !== "bob");
  assert.equal(productionShots(p)[1].referenceImages[0].url, "");
  assert.equal(productionShots(p)[1].referenceImages[0].revision, "missing");
});
test("regenerating a storyboard retains matching shot bindings across a save/reload", () => {
  const original = fixture().creation.storyboardShots;
  const regenerated = original.map((shot) => {
    const copy = { ...shot };
    delete copy.referenceNodeIds;
    return copy;
  });
  const normalized = normalizeShots(regenerated, original);
  assert.deepEqual(normalized[0].referenceNodeIds, ["alice", "station"]);
  assert.deepEqual(normalizeShots(JSON.parse(JSON.stringify(normalized)))[1].referenceNodeIds, [
    "bob",
  ]);
  assert.deepEqual(normalizeShots([shot("one", [])], original)[0].referenceNodeIds, []);
});

test("storyboard cast and scene automatically bind reference images without manual selection", () => {
  const p = fixture();
  p.nodes[2].id = "scene_reference_a";
  p.creation.storyOutline = {
    characters: [{ name: "alice" }, { name: "bob" }],
    scenes: [{ id: "a", title: "station" }],
  };
  p.creation.storyboardShots = [
    { ...shot("one"), characterNames: ["alice"] },
    { ...shot("two"), characterNames: [] },
  ];
  const result = productionShots(p);
  assert.deepEqual(
    result[0].referenceImages.map((ref) => ref.nodeId),
    ["alice", "scene_reference_a"],
  );
  assert.deepEqual(
    result[1].referenceImages.map((ref) => ref.nodeId),
    ["scene_reference_a"],
  );
  p.creation.storyboardShots[0].referenceNodeIds = ["bob"];
  assert.deepEqual(
    productionShots(p)[0].referenceImages.map((ref) => ref.nodeId),
    ["bob"],
  );
});

test("legacy cast matching uses shot action names and never the full character bible", () => {
  const p = fixture();
  p.nodes[2].id = "scene_reference_a";
  p.creation.storyOutline = {
    characters: [{ name: "alice" }, { name: "bob" }],
    scenes: [{ id: "a", title: "station" }],
  };
  p.creation.storyboardShots = [
    { ...shot("one"), action: "alice walks", characterDescriptions: ["alice", "bob"] },
  ];
  assert.deepEqual(
    productionShots(p)[0].referenceImages.map((ref) => ref.nodeId),
    ["alice", "scene_reference_a"],
  );
  p.nodes = p.nodes.filter((node) => node.id !== "alice");
  assert.equal(productionShots(p)[0].referenceImages[0].url, "");
});
