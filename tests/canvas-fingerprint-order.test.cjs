const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  load = require("./load-ts.cjs");
const { fingerprint, legacyFingerprint, isStale } = load("lib/canvas/workflow.ts");
const { canvasResultPatch } = load("lib/generation/results.ts");
const fixture = () => ({
  id: "p",
  name: "story",
  nodes: [
    {
      id: "image",
      type: "image",
      data: {
        nodeType: "image",
        title: "image",
        prompt: "rain",
        style: "anime",
        imageUrl: "/api/media/image",
      },
    },
    { id: "video", type: "video", data: { nodeType: "video", scenePrompt: "pick up key" } },
  ],
  edges: [
    {
      id: "iv",
      source: "image",
      target: "video",
      data: { kind: "context", inputRole: "first-frame" },
    },
  ],
});
function reordered(p) {
  const q = structuredClone(p);
  q.nodes[0].data = {
    imageUrl: q.nodes[0].data.imageUrl,
    ...Object.fromEntries(Object.entries(q.nodes[0].data).filter(([k]) => k !== "imageUrl")),
  };
  return q;
}
test("equivalent API field order has the same canonical fingerprint while actual input edits invalidate it", () => {
  const p = fixture(),
    q = reordered(p);
  assert.notEqual(legacyFingerprint(p, "video"), legacyFingerprint(q, "video"));
  assert.equal(fingerprint(p, "video"), fingerprint(q, "video"));
  q.nodes[0].data.prompt = "changed";
  assert.notEqual(fingerprint(p, "video"), fingerprint(q, "video"));
});
test("legacy pending result already in history can be applied once with canonical snapshot proof", () => {
  const p = fixture(),
    q = reordered(p),
    job = {
      id: "job",
      projectId: "p",
      nodeId: "video",
      kind: "video",
      status: "succeeded",
      url: "/api/media/video",
      fingerprint: legacyFingerprint(p, "video"),
      sourceFingerprint: fingerprint(p, "video"),
      updatedAt: "now",
    };
  q.nodes[1].data.generationVersions = [
    { id: "job", url: job.url, fingerprint: job.fingerprint, createdAt: "now" },
  ];
  const patch = canvasResultPatch(q, job);
  assert.equal(patch.videoUrl, job.url);
  assert.equal(patch.generationVersions.length, 1);
  Object.assign(q.nodes[1].data, patch);
  assert.equal(isStale(q, q.nodes[1]), false);
  assert.equal(canvasResultPatch(q, job), null);
  const changed = reordered(p);
  changed.nodes[0].data.prompt = "edited";
  assert.equal(canvasResultPatch(changed, job).videoUrl, undefined);
  const selected = reordered(p);
  selected.nodes[1].data.videoUrl = "/manual";
  assert.equal(canvasResultPatch(selected, job).videoUrl, undefined);
});
test("already selected legacy material is upgraded without replacing its selected result", () => {
  const p = fixture(),
    job = {
      id: "job",
      projectId: "p",
      nodeId: "video",
      kind: "video",
      status: "succeeded",
      url: "/api/media/video",
      fingerprint: legacyFingerprint(p, "video"),
      sourceFingerprint: fingerprint(p, "video"),
      updatedAt: "now",
    };
  Object.assign(p.nodes[1].data, {
    videoUrl: job.url,
    generationJobId: job.id,
    generationFingerprint: job.fingerprint,
    generationVersions: [{ id: job.id, url: job.url, fingerprint: job.fingerprint }],
  });
  assert.equal(isStale(p, p.nodes[1]), false);
  const patch = canvasResultPatch(p, job);
  assert.ok(patch.generationFingerprint.startsWith("v2:"));
  assert.equal(patch.videoUrl, job.url);
});
