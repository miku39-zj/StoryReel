const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load-ts.cjs");
const { reconcileCanvasAssets } = load("lib/production/canvas-assets.ts");
const { emptyProduction, selectedAsset } = load("lib/production/types.ts");
const shot = {
  shotId: "shot",
  sceneId: "scene",
  shotIndex: 0,
  frameType: "中景",
  cameraMove: "still",
  lighting: "night",
  action: "walk",
  duration: 5,
  imagePrompt: "anime",
};
const project = () => ({
  id: "p",
  updatedAt: "2026-11-04T00:00:00Z",
  nodes: [
    {
      id: "video_scene",
      type: "video",
      data: { nodeType: "video", title: "scene", videoUrl: "/api/media/a" },
    },
  ],
  edges: [],
  creation: { storyboardShots: [shot] },
});
test("canvas selection changes reuse immutable versions and respect explicit shot choices", () => {
  const p = project(),
    s = emptyProduction("p");
  reconcileCanvasAssets(p, s);
  const a = selectedAsset(s, "shot", "video");
  p.nodes[0].data.videoUrl = "/api/media/b";
  reconcileCanvasAssets(p, s);
  const b = selectedAsset(s, "shot", "video");
  assert.notEqual(a.id, b.id);
  p.nodes[0].data.videoUrl = a.url;
  reconcileCanvasAssets(p, s);
  assert.equal(selectedAsset(s, "shot", "video").id, a.id);
  assert.equal(s.assets.length, 2);
  s.selectionRevisions = { shot: { video: 1 } };
  p.nodes[0].data.videoUrl = b.url;
  reconcileCanvasAssets(p, s);
  assert.equal(selectedAsset(s, "shot", "video").id, a.id);
});
test("segments map only to their exact shot identity and current revision", () => {
  const p = project(),
    s = emptyProduction("p");
  p.creation.storyboardShots = [shot, { ...shot, shotId: "other", shotIndex: 1 }];
  const { shotRevision } = load("lib/production/shots.ts");
  p.nodes[0].data.segments = [
    {
      shotId: "shot",
      videoUrl: "/api/media/shot",
      videoVersionId: "prior",
      duration: 5,
      sourceRevision: shotRevision(shot),
    },
  ];
  reconcileCanvasAssets(p, s);
  assert.equal(s.assets.length, 1);
  assert.equal(s.assets[0].shotId, "shot");
  assert.equal(s.assets[0].url, "/api/media/shot");
});
