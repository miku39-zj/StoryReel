const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load-ts.cjs");
const { connectionNodeOptions } = load("lib/story/connection-options.ts");
const { useCanvasStore: store } = load("stores/canvas-store.ts");

const ports = {
  video: ["input", "output"],
  image: ["input", "output"],
  text: ["output"],
  choice: ["input", "output"],
  condition: ["input", "output"],
  merge: ["input", "output"],
  ending: ["input"],
};

test("all rendered inlet and outlet types offer nodes and every choice creates a correctly directed connection", () => {
  for (const [type, directions] of Object.entries(ports))
    for (const direction of directions) {
      const options = connectionNodeOptions(type, direction);
      assert.ok(options.length > 0, `${type} ${direction} has no options`);
      for (const option of options) {
        store.setState(store.getInitialState());
        const anchor = store.getState().addNode(type, { x: 300, y: 300 });
        const created = store
          .getState()
          .addConnectedNode(anchor, direction, option.type, option.data, { x: 100, y: 120 });
        assert.ok(created, `${type} ${direction}: ${option.label}`);
        const edge = store.getState().edges[0];
        assert.equal(edge.source, direction === "input" ? created : anchor);
        assert.equal(edge.target, direction === "input" ? anchor : created);
        assert.deepEqual(store.getState().nodes.find((n) => n.id === created).position, {
          x: 100,
          y: 120,
        });
      }
    }
});

test("a video inlet includes text and image sources as well as previous story nodes", () => {
  const options = connectionNodeOptions("video", "input");
  assert.ok(options.some((o) => o.type === "text" && o.data.kind === "context"));
  assert.ok(options.some((o) => o.type === "image" && o.data.kind === "context"));
  assert.ok(options.some((o) => o.type === "video" && o.data.kind === "flow"));
});
