const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const load = require("./load-ts.cjs");
const { getDatabase, closeDatabases, transaction } = load("lib/server/database.ts");
const ledger = load("lib/server/generation-ledger.ts");
const { getProduction, updateProduction } = load("lib/server/production-store.ts");
const { claimTask, ownsTask, isRunnable, failOperation } = load("lib/generation/lifecycle.ts");
async function isolated(fn) {
  closeDatabases();
  const previous = process.env.STORYREEL_DATA_DIR,
    root = await fs.mkdtemp(path.join(os.tmpdir(), "ledger-"));
  process.env.STORYREEL_DATA_DIR = root;
  try {
    await fn();
  } finally {
    closeDatabases();
    if (previous === undefined) delete process.env.STORYREEL_DATA_DIR;
    else process.env.STORYREEL_DATA_DIR = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
}
const job = (id) => ({
  id,
  projectId: "p",
  nodeId: "n",
  kind: "image",
  status: "queued",
  createdAt: "now",
  updatedAt: "now",
});
test("old canvas and shot records migrate atomically once and retain provider IDs and versions", () =>
  isolated(async () => {
    let db = getDatabase();
    db.prepare("DELETE FROM app_metadata WHERE key='generation-ledger-v1'").run();
    db.exec("CREATE TABLE canvas_jobs (id TEXT PRIMARY KEY,project_id TEXT,document TEXT)");
    const canvas = {
      ...job("canvas"),
      status: "running",
      lease: 42,
      nextPoll: 73,
      task: { status: "https://queue.fal.run/status" },
    };
    db.prepare("INSERT INTO canvas_jobs VALUES (?,?,?)").run("canvas", "p", JSON.stringify(canvas));
    const shot = { ...job("shot"), shotId: "s", providerTask: { requestId: "paid-request" } };
    const asset = {
      id: "asset",
      jobId: "old",
      shotId: "s",
      kind: "image",
      version: 1,
      url: "/api/media/a",
      sourceRevision: "r",
      createdAt: "now",
    };
    db.prepare("INSERT INTO production_states VALUES (?,?,?)").run(
      "p",
      4,
      JSON.stringify({
        projectId: "p",
        jobs: [shot],
        assets: [asset],
        selected: { s: { image: "asset" } },
      }),
    );
    closeDatabases();
    db = getDatabase();
    const migrated = ledger.tasks(db, "canvas", "p")[0];
    assert.equal(migrated.leaseUntil, 42);
    assert.equal(migrated.nextRunAt, 73);
    assert.deepEqual(migrated.task, canvas.task);
    const state = await getProduction("p");
    assert.equal(state.revision, 4);
    assert.deepEqual(state.jobs, [shot]);
    assert.deepEqual(state.assets, [asset]);
    assert.equal(state.selected.s.image, "asset");
    const metadata = JSON.parse(
      db.prepare("SELECT document FROM production_states").get().document,
    );
    assert.equal(metadata.jobs, undefined);
    assert.equal(metadata.assets, undefined);
    assert.equal(
      db.prepare("SELECT 1 FROM sqlite_master WHERE name='canvas_jobs'").get(),
      undefined,
    );
    closeDatabases();
    assert.equal(ledger.tasks(getDatabase(), "canvas").length, 1);
  }));
test("immutable asset conflicts roll back the task update in the same transaction", () =>
  isolated(async () => {
    const asset = {
      id: "a",
      jobId: "j",
      shotId: "s",
      kind: "image",
      version: 1,
      url: "/api/media/a",
      sourceRevision: "r",
      createdAt: "now",
    };
    await updateProduction("p", (s) => {
      s.jobs.push({ ...job("j"), shotId: "s" });
      s.assets.push(asset);
    });
    await assert.rejects(
      () =>
        updateProduction("p", (s) => {
          s.jobs[0].status = "succeeded";
          s.assets[0].url = "/replacement";
        }),
      /不可修改/,
    );
    const state = await getProduction("p");
    assert.equal(state.jobs[0].status, "queued");
    assert.equal(state.assets[0].url, asset.url);
  }));
test("canvas result versions enter the shared library before browser application", () =>
  isolated(async () => {
    const { listAssets } = load("lib/server/assets.ts"),
      db = getDatabase();
    const result = {
      ...job("result"),
      status: "succeeded",
      url: "/api/media/result",
      fingerprint: "input",
    };
    transaction(db, () => {
      ledger.saveTask(db, "p", "canvas", result);
      ledger.recordCanvasVersion(db, result);
      ledger.recordCanvasVersion(db, result);
    });
    assert.equal(ledger.versions(db, "canvas", "p").length, 1);
    assert.ok((await listAssets()).some((a) => a.id === "result"));
  }));
test("shared leases fence cancellation and takeover; ambiguous submission never reissues", () => {
  const task = job("lease");
  assert.ok(isRunnable(task));
  assert.ok(claimTask(task, "worker-a", false));
  assert.ok(ownsTask(task, "worker-a"));
  task.status = "cancelled";
  assert.equal(ownsTask(task, "worker-a"), false);
  task.status = "running";
  task.owner = "worker-b";
  assert.equal(ownsTask(task, "worker-a"), false);
  task.leaseUntil = 0;
  assert.equal(claimTask(task, "worker-c", false), false);
  assert.equal(task.status, "failed");
  assert.match(task.error, /未自动重复/);
  const polling = { ...job("poll"), status: "running" };
  for (let i = 0; i < 4; i++) failOperation(polling, new Error("network"), true, 0);
  assert.equal(polling.status, "failed");
});
test("completed canvas results preserve a newer user selection and ignore other projects", () => {
  const { canvasResultPatch } = load("lib/generation/results.ts"),
    { fingerprint } = load("lib/canvas/workflow.ts");
  const project = {
    id: "p",
    nodes: [
      {
        id: "n",
        type: "image",
        data: {
          nodeType: "image",
          prompt: "portrait",
          imageUrl: "/manual",
          generationJobId: "manual",
        },
      },
    ],
    edges: [],
  };
  const result = {
    ...job("result"),
    status: "succeeded",
    url: "/generated",
    fingerprint: fingerprint(project, "n"),
  };
  const patch = canvasResultPatch(project, result);
  assert.equal(patch.imageUrl, undefined);
  assert.equal(patch.generationVersions.length, 1);
  assert.equal(canvasResultPatch({ ...project, id: "other" }, result), null);
});
test("late shot provider responses cannot revive a stopped task with the same owner", () =>
  isolated(async () => {
    const { putProject } = load("lib/server/projects.ts"),
      { submitProduction } = load("lib/server/production.ts"),
      { workerTick } = load("lib/server/generation-worker.ts");
    const shot = {
      shotId: "s",
      sceneId: "scene",
      shotIndex: 0,
      frameType: "中景",
      cameraMove: "fixed",
      lighting: "day",
      action: "walk",
      imagePrompt: "portrait",
      duration: 5,
    };
    await putProject({
      id: "p",
      name: "p",
      createdAt: "now",
      updatedAt: "now",
      nodes: [],
      edges: [],
      creation: { storyboardShots: [shot] },
    });
    await submitProduction("p", {
      action: "generate",
      kind: "image",
      shotIds: ["s"],
      requestKey: "late",
    });
    let started, release;
    const ready = new Promise((r) => (started = r)),
      held = new Promise((r) => (release = r));
    const ticking = workerTick({
      owner: "same-owner",
      provider: {
        submit: async () => {
          started();
          await held;
          return {
            state: "pending",
            task: { provider: "mock", requestId: "late", statusUrl: "", resultUrl: "" },
          };
        },
        poll: async () => {
          throw Error("unexpected poll");
        },
      },
    });
    await ready;
    await updateProduction("p", (state) => {
      state.jobs[0].status = "failed";
      state.jobs[0].error = "stopped";
    });
    release();
    await ticking;
    const state = await getProduction("p");
    assert.equal(state.jobs[0].status, "failed");
    assert.equal(state.jobs[0].providerTask, undefined);
    assert.equal(state.assets.length, 0);
  }));
