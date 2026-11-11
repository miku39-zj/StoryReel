const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load-ts.cjs");
const { useCanvasStore: canvas } = load("stores/canvas-store.ts");
const { useCanvasJobs: jobs } = load("stores/canvas-jobs-store.ts");
test("background refresh preserves a submission error until the next explicit attempt", async () => {
  const previous = global.fetch;
  canvas.getState().loadProject({ id: "error-test", name: "test", nodes: [], edges: [] });
  jobs.setState(jobs.getInitialState());
  try {
    global.fetch = async () => Response.json({ error: "不支持当前图片输入协议" }, { status: 400 });
    await jobs.getState().submit(["video"]);
    assert.equal(jobs.getState().error, "不支持当前图片输入协议");
    global.fetch = async () => Response.json({ jobs: [], workerOnline: false });
    await jobs.getState().refresh();
    assert.equal(jobs.getState().error, "不支持当前图片输入协议");
    global.fetch = async () =>
      Response.json({ quote: { nodeIds: ["video"], images: 0, videos: 1, total: 1 } });
    await jobs.getState().submit(["video"]);
    assert.equal(jobs.getState().error, "");
    assert.ok(jobs.getState().pending);
  } finally {
    global.fetch = previous;
    canvas.setState(canvas.getInitialState());
    jobs.setState(jobs.getInitialState());
  }
});
