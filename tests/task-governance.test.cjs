const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const load = require("./load-ts.cjs");
const { getDatabase, closeDatabases } = load("lib/server/database.ts");
const { putProject, getProject, deleteProject, restoreProjectRevision } =
  load("lib/server/projects.ts");
const { enqueueCanvas, canvasWorkerTick, canvasJobs } = load("lib/server/canvas-jobs.ts");
const { submitProduction } = load("lib/server/production.ts");
const { getProduction } = load("lib/server/production-store.ts");
const { workerTick } = load("lib/server/generation-worker.ts");
const { activeTaskCount } = load("lib/server/task-governance.ts");
const collection = load("app/api/projects/route.ts"),
  item = load("app/api/projects/[id]/route.ts");
function fixture(id = "governance", count = 1) {
  const now = new Date().toISOString();
  return {
    id,
    name: id,
    createdAt: now,
    updatedAt: now,
    nodes: [
      {
        id: "image",
        type: "image",
        position: { x: 0, y: 0 },
        data: { nodeType: "image", title: "image", prompt: "portrait" },
      },
    ],
    edges: [],
    creation: {
      storyboardShots: Array.from({ length: count }, (_, i) => ({
        shotId: `shot-${i}`,
        sceneId: "scene",
        shotIndex: i,
        frameType: "中景",
        cameraMove: "fixed",
        lighting: "day",
        action: "walk",
        duration: 5,
        imagePrompt: "portrait",
      })),
    },
  };
}
async function isolated(fn) {
  closeDatabases();
  const previous = {
    dir: process.env.STORYREEL_DATA_DIR,
    max: process.env.STORYREEL_MAX_ACTIVE,
    batch: process.env.STORYREEL_MAX_BATCH,
    fetch: global.fetch,
  };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "task-governance-"));
  process.env.STORYREEL_DATA_DIR = root;
  try {
    await fn();
  } finally {
    closeDatabases();
    global.fetch = previous.fetch;
    for (const [k, v] of Object.entries({
      STORYREEL_DATA_DIR: previous.dir,
      STORYREEL_MAX_ACTIVE: previous.max,
      STORYREEL_MAX_BATCH: previous.batch,
    })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}
const generate = (p, kind = "image", key = "request") =>
  submitProduction(p.id, {
    action: "generate",
    kind,
    shotIds: p.creation.storyboardShots.map((s) => s.shotId),
    requestKey: key,
  });
test("deleting a project atomically stops both queues and fences stale submissions", () =>
  isolated(async () => {
    const p = fixture();
    await putProject(p);
    enqueueCanvas(p, ["image"], "canvas");
    await generate(p);
    assert.equal(activeTaskCount(getDatabase(), p.id), 2);
    assert.equal(await deleteProject(p.id), true);
    assert.equal(activeTaskCount(getDatabase(), p.id), 0);
    assert.equal(canvasJobs(p.id)[0].status, "cancelled");
    assert.equal((await getProduction(p.id)).jobs[0].status, "failed");
    let calls = 0;
    global.fetch = async () => {
      calls++;
      throw new Error("must not call providers");
    };
    await canvasWorkerTick();
    await workerTick();
    assert.equal(calls, 0);
    assert.throws(() => enqueueCanvas(p, ["image"], "stale"), /已删除/);
    await assert.rejects(() => putProject(p), /已删除/);
  }));
test("deletion invalidates ownership of an already executing external request", () =>
  isolated(async () => {
    const p = fixture();
    await putProject(p);
    enqueueCanvas(p, ["image"], "inflight");
    const key = process.env.FAL_API_KEY;
    process.env.FAL_API_KEY = "test";
    let started, release;
    const ready = new Promise((r) => (started = r));
    const held = new Promise((r) => (release = r));
    global.fetch = async () => {
      started();
      await held;
      return Response.json({
        request_id: "remote",
        status_url: "https://queue.fal.run/remote/status",
        response_url: "https://queue.fal.run/remote/result",
      });
    };
    try {
      const tick = canvasWorkerTick();
      await ready;
      await deleteProject(p.id);
      release();
      await tick;
      assert.equal(canvasJobs(p.id)[0].status, "cancelled");
    } finally {
      if (key === undefined) delete process.env.FAL_API_KEY;
      else process.env.FAL_API_KEY = key;
    }
  }));
test("both queues consume one global quota and rejected shot batches roll back completely", () =>
  isolated(async () => {
    process.env.STORYREEL_MAX_ACTIVE = "2";
    const p = fixture();
    await putProject(p);
    enqueueCanvas(p, ["image"], "one");
    await generate(p);
    assert.equal(activeTaskCount(getDatabase()), 2);
    const other = fixture("other");
    await putProject(other);
    await assert.rejects(() => generate(other), /上限/);
    assert.equal((await getProduction(other.id)).jobs.length, 0);
    assert.throws(() => enqueueCanvas(other, ["image"], "three"), /上限/);
  }));
test("shot batch limits count actual new dependencies and idempotent requests use no extra quota", () =>
  isolated(async () => {
    const p = fixture("batch", 13);
    await putProject(p);
    await assert.rejects(() => generate(p, "pipeline"), /单批上限/);
    assert.equal((await getProduction(p.id)).jobs.length, 0);
    const one = fixture("one");
    await putProject(one);
    await generate(one, "image", "key");
    process.env.STORYREEL_MAX_ACTIVE = "1";
    await generate(one, "image", "key");
    assert.equal(activeTaskCount(getDatabase()), 1);
  }));
test("history restore checks shot tasks as well as canvas tasks", () =>
  isolated(async () => {
    const p = fixture();
    await putProject(p);
    await putProject({ ...p, name: "changed" });
    await generate(p);
    await assert.rejects(() => restoreProjectRevision(p.id, 1, 2), /等待或取消/);
    assert.equal((await getProject(p.id)).name, "changed");
  }));
test("HTTP updates cannot bypass revision checks by omitting If-Match or revision", () =>
  isolated(async () => {
    const p = { ...fixture(), creation: undefined };
    const saved = await putProject(p);
    const req = (body) =>
      new Request("http://localhost/api/projects", { method: "POST", body: JSON.stringify(body) });
    assert.equal((await collection.POST(req({ ...p, name: "blind" }))).status, 409);
    assert.equal(
      (await item.PUT(req({ name: "blind" }), { params: Promise.resolve({ id: p.id }) })).status,
      428,
    );
    assert.equal(
      (
        await item.PUT(req({ name: "safe", revision: saved.revision }), {
          params: Promise.resolve({ id: p.id }),
        })
      ).status,
      200,
    );
    assert.equal((await getProject(p.id)).name, "safe");
  }));
