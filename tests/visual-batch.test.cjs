const { test } = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const load = require("./load-ts.cjs");
const { getDatabase, closeDatabases } = load("lib/server/database.ts");
const { putProject, getProject } = load("lib/server/projects.ts");
const { getProduction, updateProduction } = load("lib/server/production-store.ts");
const { tasks, saveTask } = load("lib/server/generation-ledger.ts");
const { startVisualBatch, getVisualBatch, visualBatchTick } = load("lib/server/visual-batch.ts");
const { adoptVisualResults } = load("lib/production/visual-plan.ts");
const { canvasJobs } = load("lib/server/canvas-jobs.ts");
const { fingerprint } = load("lib/canvas/workflow.ts");
const { submitProduction } = load("lib/server/production.ts");
async function isolated(fn) {
  const previous = { ...process.env },
    root = await fs.mkdtemp(path.join(os.tmpdir(), "visual-batch-"));
  process.env.STORYREEL_DATA_DIR = root;
  process.env.IMAGE_PROVIDER = "openai";
  process.env.STORYREEL_MAX_BATCH = "1";
  process.env.STORYREEL_MAX_ACTIVE = "2";
  try {
    await fn();
  } finally {
    closeDatabases();
    for (const key of [
      "STORYREEL_DATA_DIR",
      "STORYREEL_MAX_BATCH",
      "STORYREEL_MAX_ACTIVE",
      "IMAGE_PROVIDER",
    ]) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}
function fixture(count = 30) {
  const now = new Date().toISOString();
  return {
    id: "visual",
    name: "test",
    createdAt: now,
    updatedAt: now,
    nodes: [
      {
        id: "role",
        type: "image",
        position: { x: 0, y: 0 },
        data: { nodeType: "image", assetKind: "character", title: "角色", prompt: "portrait" },
      },
      {
        id: "done",
        type: "image",
        position: { x: 0, y: 0 },
        data: { nodeType: "image", imageUrl: "/api/media/existing", prompt: "finished" },
      },
    ],
    edges: [],
    creation: {
      storyboardShots: Array.from({ length: count }, (_, i) => ({
        shotId: `shot_${i}`,
        sceneId: "scene",
        shotIndex: i,
        frameType: "中景",
        cameraMove: "fixed",
        lighting: "day",
        action: "walk",
        duration: 5,
        imagePrompt: "walk",
        ...(i === 0 ? { dialogue: "你好", speaker: "旁白" } : {}),
      })),
    },
  };
}
async function finish() {
  const db = getDatabase();
  for (const job of tasks(db, "canvas", "visual").filter((j) =>
    ["queued", "running"].includes(j.status),
  ))
    saveTask(db, "visual", "canvas", {
      ...job,
      status: "succeeded",
      fingerprint: fingerprint(job.project, job.nodeId),
      url: "/api/media/role",
      updatedAt: new Date().toISOString(),
    });
  await updateProduction("visual", (s) => {
    for (const j of s.jobs.filter((j) => ["queued", "running"].includes(j.status))) {
      j.status = "succeeded";
      const asset = {
        id: "asset_" + j.id,
        jobId: j.id,
        shotId: j.shotId,
        sceneId: j.shot.sceneId,
        kind: j.kind,
        version: 1,
        url: "/api/media/" + j.id,
        createdAt: new Date().toISOString(),
        sourceRevision: j.sourceRevision,
        provider: "offline",
      };
      s.assets.push(asset);
      s.selected[j.shotId] = { ...s.selected[j.shotId], [j.kind]: asset.id };
    }
  });
}
test("one click schedules 30 shots within capacity, skips completed images and silent audio, resumes without duplicates", () =>
  isolated(async () => {
    await putProject(fixture());
    const first = await startVisualBatch("visual");
    assert.equal((await startVisualBatch("visual")).id, first.id);
    await visualBatchTick("visual");
    assert.equal(canvasJobs("visual").length, 1);
    assert.equal((await getProduction("visual")).jobs.length, 0);
    closeDatabases();
    await finish();
    for (let i = 0; i < 40 && getVisualBatch("visual").status === "running"; i++) {
      await visualBatchTick("visual");
      await finish();
    }
    assert.equal(getVisualBatch("visual").status, "done");
    assert.equal(canvasJobs("visual").length, 1);
    const state = await getProduction("visual");
    assert.equal(state.jobs.length, 31);
    assert.equal(state.jobs.filter((j) => j.kind === "audio").length, 1);
    assert.equal(state.jobs.filter((j) => j.kind === "video").length, 0);
    assert.equal((await getProject("visual")).nodes[0].data.imageUrl, "/api/media/role");
    await startVisualBatch("visual");
    await visualBatchTick("visual");
    assert.equal(getVisualBatch("visual").status, "done");
    assert.equal((await getProduction("visual")).jobs.length, 31);
    await submitProduction("visual", {
      action: "generate",
      kind: "visual",
      shotIds: ["shot_0"],
      requestKey: "repeat-visual",
    });
    assert.equal((await getProduction("visual")).jobs.length, 31);
  }));
test("failed tasks stop a batch without automatic paid retries; edited inputs also stop remaining work", () =>
  isolated(async () => {
    await putProject(fixture(1));
    await startVisualBatch("visual");
    await visualBatchTick("visual");
    const db = getDatabase(),
      j = tasks(db, "canvas", "visual")[0];
    saveTask(db, "visual", "canvas", { ...j, status: "failed", error: "provider failed" });
    await visualBatchTick("visual");
    assert.equal(getVisualBatch("visual").status, "failed");
    assert.equal(canvasJobs("visual").length, 1);
    await startVisualBatch("visual");
    const p = await getProject("visual");
    p.nodes[0].data.prompt = "new appearance";
    await putProject(p, p.revision);
    await visualBatchTick("visual");
    assert.match(getVisualBatch("visual").error, /修改/);
    assert.equal(canvasJobs("visual").length, 1);
  }));
test("generated results can advance the client revision, while manual selections and edited inputs remain protected", () =>
  isolated(async () => {
    const local = fixture(0);
    await putProject(local);
    await startVisualBatch("visual");
    await visualBatchTick("visual");
    await finish();
    await visualBatchTick("visual");
    const remote = await getProject("visual");
    const rebased = adoptVisualResults(local, remote, canvasJobs("visual"));
    assert.equal(rebased.revision, remote.revision);
    assert.equal(rebased.nodes[0].data.imageUrl, "/api/media/role");
    const manual = structuredClone(local);
    manual.nodes[0].data.imageUrl = "/api/media/manual";
    assert.equal(adoptVisualResults(manual, remote, canvasJobs("visual")), null);
    const edited = structuredClone(local);
    edited.nodes[0].data.prompt = "new";
    assert.equal(adoptVisualResults(edited, remote, canvasJobs("visual")), null);
  }));

test("dependent frame image snapshots the completed role image before shot production starts", () =>
  isolated(async () => {
    const p = fixture(1);
    p.nodes.push({
      id: "frame",
      type: "image",
      position: { x: 300, y: 0 },
      data: { nodeType: "image", title: "frame", prompt: "scene" },
    });
    p.edges.push({
      id: "ref",
      source: "role",
      target: "frame",
      data: { kind: "context", inputRole: "reference-image" },
    });
    await putProject(p);
    await startVisualBatch("visual");
    await visualBatchTick("visual");
    assert.equal(canvasJobs("visual")[0].nodeId, "role");
    await finish();
    await visualBatchTick("visual");
    const frame = tasks(getDatabase(), "canvas", "visual").find((j) => j.nodeId === "frame");
    assert.ok(frame, getVisualBatch("visual").error);
    assert.equal(frame.project.nodes.find((n) => n.id === "role").data.imageUrl, "/api/media/role");
    assert.equal((await getProduction("visual")).jobs.length, 0);
  }));

test("character and scene batches have independent scopes and never enqueue the other type or audio", () =>
  isolated(async () => {
    const p = fixture(2);
    await putProject(p);
    const role = await startVisualBatch("visual", "characters");
    const scene = await startVisualBatch("visual", "scenes");
    assert.notEqual(role.id, scene.id);
    await visualBatchTick("visual");
    await finish();
    for (let i = 0; i < 5; i++) {
      await visualBatchTick("visual");
      await finish();
    }
    assert.equal(getVisualBatch("visual", "characters").status, "done");
    assert.equal(getVisualBatch("visual", "scenes").status, "done");
    assert.equal(canvasJobs("visual").length, 1);
    const jobs = (await getProduction("visual")).jobs;
    assert.equal(jobs.length, 2);
    assert.ok(jobs.every((j) => j.kind === "image"));
  }));
test("scene batch waits for an explicitly started character batch, but never creates a missing character itself", () =>
  isolated(async () => {
    const p = fixture(0);
    p.nodes.push({
      id: "frame",
      type: "image",
      position: { x: 300, y: 0 },
      data: { nodeType: "image", title: "frame", prompt: "scene" },
    });
    p.edges.push({
      id: "ref",
      source: "role",
      target: "frame",
      data: { kind: "context", inputRole: "reference-image" },
    });
    await putProject(p);
    await startVisualBatch("visual", "scenes");
    await visualBatchTick("visual");
    assert.equal(canvasJobs("visual").length, 0);
    assert.match(getVisualBatch("visual", "scenes").error, /角色/);
    await startVisualBatch("visual", "scenes");
    await startVisualBatch("visual", "characters");
    await visualBatchTick("visual");
    await finish();
    for (let i = 0; i < 4; i++) {
      await visualBatchTick("visual");
      await finish();
    }
    assert.equal(getVisualBatch("visual", "scenes").status, "done");
    assert.equal(canvasJobs("visual").length, 2);
  }));

test("manual completion reconciles a failed batch without erasing job history or submitting work", () =>
  isolated(async () => {
    const { reconcileVisualBatches } = load("lib/server/visual-batch.ts");
    const p = fixture(1);
    p.nodes = [];
    await putProject(p);
    await startVisualBatch(p.id, "scenes");
    await visualBatchTick(p.id);
    const db = getDatabase();
    const row = db
      .prepare("SELECT document FROM visual_batches_scoped WHERE project_id=? AND scope='scenes'")
      .get(p.id);
    const batch = JSON.parse(row.document);
    batch.status = "failed";
    batch.error = "old failure";
    db.prepare(
      "UPDATE visual_batches_scoped SET document=? WHERE project_id=? AND scope='scenes'",
    ).run(JSON.stringify(batch), p.id);
    reconcileVisualBatches(await getProject(p.id), await getProduction(p.id));
    assert.equal(getVisualBatch(p.id, "scenes").status, "failed");
    await finish();
    const state = await getProduction(p.id),
      before = JSON.stringify(state.jobs);
    reconcileVisualBatches(await getProject(p.id), state);
    assert.equal(getVisualBatch(p.id, "scenes").status, "done");
    assert.equal(getVisualBatch(p.id, "scenes").error, undefined);
    assert.equal(JSON.stringify((await getProduction(p.id)).jobs), before);
    assert.equal(getVisualBatch(p.id, "characters"), null);
  }));

test("resuming an offline batch through the API processes the saved plan once", () =>
  isolated(async () => {
    const { POST } = load("app/api/projects/[id]/production/route.ts");
    const { projectWorkerOnline } = load("lib/server/project-worker.ts");
    const originalFetch = global.fetch;
    const originalKey = process.env.IMAGE_API_KEY;
    const originalBase = process.env.IMAGE_BASE_URL;
    let calls = 0;
    process.env.IMAGE_API_KEY = "test";
    process.env.IMAGE_BASE_URL = "https://images.test/v1";
    global.fetch = async () => {
      calls++;
      return Response.json({
        data: [
          {
            b64_json:
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          },
        ],
      });
    };
    try {
      await putProject(fixture(0));
      const saved = await startVisualBatch("visual", "characters");
      assert.equal(projectWorkerOnline("visual"), false);
      const resume = () =>
        POST(
          new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ action: "resume-visual-batch", scope: "characters" }),
          }),
          { params: Promise.resolve({ id: "visual" }) },
        );
      const responses = await Promise.all([resume(), resume()]);
      assert.ok(responses.every((response) => response.ok));
      const deadline = Date.now() + 5000;
      while (projectWorkerOnline("visual") && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(projectWorkerOnline("visual"), false);
      const completed = getVisualBatch("visual", "characters");
      assert.equal(completed.id, saved.id);
      assert.equal(completed.status, "done");
      assert.equal(calls, 1);
      assert.equal(canvasJobs("visual").length, 1);
    } finally {
      global.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.IMAGE_API_KEY;
      else process.env.IMAGE_API_KEY = originalKey;
      if (originalBase === undefined) delete process.env.IMAGE_BASE_URL;
      else process.env.IMAGE_BASE_URL = originalBase;
    }
  }));

test("a rejected frame does not stop the remaining shots in its batch", () =>
  isolated(async () => {
    await putProject(fixture(3));
    await startVisualBatch("visual", "frames");
    await visualBatchTick("visual");
    await updateProduction("visual", (state) => {
      const rejected = state.jobs.find((job) => job.shotId === "shot_0");
      rejected.status = "failed";
      rejected.error = "内容安全审核拒绝";
    });
    await visualBatchTick("visual");
    assert.equal(getVisualBatch("visual", "frames").status, "running");
    assert.equal(
      (await getProduction("visual")).jobs.filter((job) => job.shotId === "shot_0").length,
      1,
    );
    await finish();
    await visualBatchTick("visual");
    assert.match(getVisualBatch("visual", "frames").error, /1 个画面任务未完成/);
    assert.equal(
      (await getProduction("visual")).jobs.filter((job) => job.status === "succeeded").length,
      2,
    );
  }));
