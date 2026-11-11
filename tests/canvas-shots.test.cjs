const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load-ts.cjs");
const { syncShotCanvas } = load("lib/production/canvas-shots.ts");
const { generationInput } = load("lib/canvas/workflow.ts");
const { emptyProduction } = load("lib/production/types.ts");
function fixture() {
  const shots = [0, 1].map((i) => ({
    shotId: `s${i}`,
    sceneId: "a",
    shotIndex: i,
    frameType: "中景",
    cameraMove: "fixed",
    lighting: "day",
    action: `action${i}`,
    duration: 5,
    imagePrompt: `frame${i}`,
    characterNames: [],
  }));
  return {
    id: "test",
    name: "test",
    startNodeId: "video_a",
    nodes: [
      {
        id: "video_a",
        type: "video",
        position: { x: 0, y: 0 },
        data: { nodeType: "video", title: "A" },
      },
      { id: "end", type: "ending", position: { x: 500, y: 0 }, data: { nodeType: "ending" } },
    ],
    edges: [{ id: "exit", source: "video_a", target: "end", data: { kind: "flow" } }],
    creation: { storyboardShots: shots },
  };
}
test("materializes per-shot text and frame inputs, preserves route exits and is idempotent", () => {
  const p = fixture(),
    state = emptyProduction(p.id);
  const a = syncShotCanvas(p, state),
    b = syncShotCanvas(a, state);
  assert.deepEqual(b, a);
  assert.equal(a.nodes.length, 7);
  assert.equal(a.edges.find((e) => e.id === "exit").source, "shot_video:s1");
  assert.ok(a.edges.some((e) => e.source === "video_a" && e.target === "shot_video:s1"));
  assert.equal(new Set(a.edges.map((e) => e.id)).size, a.edges.length);
});
test("video generation reads its own frame and story text, missing image blocks submission", () => {
  const p = syncShotCanvas(fixture(), emptyProduction("test"));
  assert.throws(() => generationInput(p, "video_a"), /还没有图片/);
  p.nodes.find((n) => n.id === "shot_frame:s0").data.imageUrl = "/api/media/first";
  const input = generationInput(p, "video_a");
  assert.equal(input.mode, "image-to-video");
  assert.equal(input.firstFrameUrl, "/api/media/first");
  assert.match(input.prompt, /action0/);
  assert.equal(input.duration, 5);
});
test("canvas shot results return to the correct production slot and applying preserves the shot chain", () => {
  const { reconcileCanvasAssets } = load("lib/production/canvas-assets.ts");
  const { applyProduction } = load("lib/production/apply.ts");
  const { isStale } = load("lib/canvas/workflow.ts");
  const p = syncShotCanvas(fixture(), emptyProduction("test"));
  p.updatedAt = new Date().toISOString();
  p.nodes.find((n) => n.id === "video_a").data.videoUrl = "/api/media/a";
  p.nodes.find((n) => n.id === "shot_video:s1").data.videoUrl = "/api/media/b";
  const state = emptyProduction(p.id);
  reconcileCanvasAssets(p, state);
  assert.equal(state.assets.filter((a) => a.kind === "video").length, 2);
  const result = applyProduction(p, state);
  assert.equal(result.nodes.find((n) => n.id === "shot_video:s1").data.videoUrl, "/api/media/b");
  assert.equal(
    isStale(
      result,
      result.nodes.find((n) => n.id === "video_a"),
    ),
    false,
  );
  assert.deepEqual(result.edges, p.edges);
});
