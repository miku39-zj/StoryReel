const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  load = require("./load-ts.cjs");
const { entryFocusNodeIds } = load("lib/canvas/entry-focus.ts");
const n = (id, type, createdAt) => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: {
    nodeType: type,
    ...(type === "image"
      ? { imageUrl: "/image.png" }
      : type === "video"
        ? { videoUrl: "/video.mp4" }
        : {}),
    generationVersions: createdAt ? [{ url: "/media", createdAt }] : [],
  },
});
const edge = (source, target, kind = "context") => ({
  id: source + target,
  source,
  target,
  data: { kind },
});
test("entry focuses the latest completed node and its material inputs rather than the full story graph", () => {
  const nodes = [
    n("first", "image", "2026-11-04T01:00:00Z"),
    n("last", "image", "2026-11-04T02:00:00Z"),
    n("video", "video", "2026-11-04T03:00:00Z"),
    n("later", "video"),
    n("choice", "choice"),
  ];
  assert.deepEqual(
    entryFocusNodeIds(nodes, [
      edge("first", "video"),
      edge("last", "video"),
      edge("video", "later", "flow"),
      edge("later", "choice", "flow"),
    ]),
    ["video", "first", "last"],
  );
});
test("missing or invalid completion history fits all visible nodes, with empty canvas centered separately", () => {
  const nodes = [
    n("a", "image", "invalid-date"),
    n("b", "video"),
    { ...n("hidden", "video", "2026-11-04T04:00:00Z"), hidden: true },
  ];
  assert.deepEqual(entryFocusNodeIds(nodes, []), ["a", "b"]);
  assert.deepEqual(entryFocusNodeIds([], []), []);
});
test("entry ignores deleted/hidden inputs and safely handles material cycles", () => {
  const a = n("a", "image", "2026-11-04T01:00:00Z"),
    b = n("b", "video", "2026-11-04T02:00:00Z"),
    hidden = { ...n("hidden", "image"), hidden: true };
  assert.deepEqual(
    entryFocusNodeIds(
      [a, b, hidden],
      [edge("a", "b"), edge("b", "a"), edge("hidden", "b"), edge("deleted", "b")],
    ),
    ["b", "a"],
  );
});
