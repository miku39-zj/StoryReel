const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const load = require("./load-ts.cjs");
const { enqueueCanvas, canvasJobs, canvasWorkerTick, cancelCanvas } = load(
  "lib/server/canvas-jobs.ts",
);
const { getDatabase, closeDatabases } = load("lib/server/database.ts");
const n = (id, type, data) => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { nodeType: type, title: id, ...data },
});
const fixture = () => ({
  id: "jobs",
  name: "test",
  createdAt: "2026-10-30T00:00:00.000Z",
  updatedAt: "2026-10-30T00:00:00.000Z",
  nodes: [n("i", "image", { prompt: "portrait" }), n("v", "video", { scenePrompt: "walking" })],
  edges: [
    { id: "iv", source: "i", target: "v", data: { kind: "context", inputRole: "first-frame" } },
  ],
});
async function isolated(action) {
  closeDatabases();
  const old = {
    dir: process.env.STORYREEL_DATA_DIR,
    key: process.env.FAL_API_KEY,
    fetch: global.fetch,
  };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-jobs-"));
  process.env.STORYREEL_DATA_DIR = root;
  process.env.FAL_API_KEY = "fixture-only";
  try {
    await action(root);
  } finally {
    closeDatabases();
    global.fetch = old.fetch;
    for (const [key, value] of [
      ["STORYREEL_DATA_DIR", old.dir],
      ["FAL_API_KEY", old.key],
    ])
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    await fs.rm(root, { recursive: true, force: true });
  }
}
function ready() {
  const db = getDatabase();
  for (const row of db.prepare("SELECT id,document FROM generation_tasks").all()) {
    const j = JSON.parse(row.document);
    j.nextRunAt = 0;
    db.prepare("UPDATE generation_tasks SET document=? WHERE id=?").run(JSON.stringify(j), row.id);
  }
}
test("durable queue resumes provider IDs after restart, stores media, resolves dependencies and deduplicates requests", () =>
  isolated(async () => {
    const calls = [];
    global.fetch = async (url, options = {}) => {
      calls.push({ url, body: options.body && JSON.parse(options.body) });
      if (url === "https://queue.fal.run/fal-ai/flux/schnell")
        return Response.json({
          request_id: "img",
          status_url: "https://queue.fal.run/img/status",
          response_url: "https://queue.fal.run/img/result",
        });
      if (url.includes("seedance") && !url.includes("/requests/"))
        return Response.json({
          request_id: "vid",
          status_url: "https://queue.fal.run/vid/status",
          response_url: "https://queue.fal.run/vid/result",
        });
      if (url.endsWith("/status")) return Response.json({ status: "COMPLETED" });
      if (url.endsWith("/img/result"))
        return Response.json({ images: [{ url: "https://media.test/a.png" }] });
      if (url.endsWith("/vid/result"))
        return Response.json({ video: { url: "https://media.test/v.mp4" } });
      if (url.startsWith("https://media.test/"))
        return new Response(Buffer.from([137, 80, 78, 71, 1, 2, 3, 4]));
      throw new Error("Unexpected " + url);
    };
    const p = fixture();
    const jobs = enqueueCanvas(p, ["v"], "request-1");
    assert.equal(jobs.length, 2);
    assert.deepEqual(enqueueCanvas(p, ["v"], "request-1"), JSON.parse(JSON.stringify(jobs)));
    await canvasWorkerTick(p.id);
    closeDatabases();
    assert.equal(canvasJobs(p.id)[0].status, "running");
    for (let i = 0; i < 5; i++) {
      ready();
      await canvasWorkerTick(p.id);
    }
    const done = canvasJobs(p.id);
    assert.ok(
      done.every((j) => j.status === "succeeded"),
      JSON.stringify(done),
    );
    assert.ok(done.every((j) => j.url.startsWith("/api/media/")));
    assert.equal(
      calls.filter((c) => c.url === "https://queue.fal.run/fal-ai/flux/schnell").length,
      1,
    );
    const submit = calls.find((c) => c.url.includes("seedance"));
    assert.ok(JSON.stringify(submit.body).includes("data:image/png;base64,"));
  }));
test("cancellation blocks descendants and does not submit them", () =>
  isolated(async () => {
    global.fetch = () => {
      throw new Error("No provider calls allowed");
    };
    const jobs = enqueueCanvas(fixture(), ["v"], "cancel-request");
    await cancelCanvas("jobs", jobs[0].id);
    await canvasWorkerTick("jobs");
    assert.equal(canvasJobs("jobs")[0].status, "cancelled");
    assert.equal(canvasJobs("jobs")[1].status, "failed");
  }));
test("ambiguous submission is not reissued after lease expires", () =>
  isolated(async () => {
    const [job] = enqueueCanvas(fixture(), ["i"], "ambiguous");
    const db = getDatabase(),
      raw = JSON.parse(
        db.prepare("SELECT document FROM generation_tasks WHERE id=?").get(job.id).document,
      );
    Object.assign(raw, { status: "running", stage: "submitting", leaseUntil: 0 });
    db.prepare("UPDATE generation_tasks SET document=? WHERE id=?").run(
      JSON.stringify(raw),
      job.id,
    );
    global.fetch = () => {
      throw new Error("must not resubmit");
    };
    await canvasWorkerTick("jobs");
    assert.equal(canvasJobs("jobs")[0].status, "failed");
    assert.match(canvasJobs("jobs")[0].error, /未自动重复/);
  }));
test("resume keeps the provider task and enforces the global active limit", () =>
  isolated(async () => {
    const { resumeCanvas } = load("lib/server/canvas-jobs.ts");
    const [job] = enqueueCanvas(fixture(), ["i"], "resume");
    const db = getDatabase();
    const raw = JSON.parse(
      db.prepare("SELECT document FROM generation_tasks WHERE id=?").get(job.id).document,
    );
    Object.assign(raw, {
      status: "failed",
      stage: "polling",
      task: { requestId: "kept-id" },
      pollErrors: 4,
    });
    db.prepare("UPDATE generation_tasks SET document=? WHERE id=?").run(
      JSON.stringify(raw),
      job.id,
    );
    const old = process.env.STORYREEL_MAX_ACTIVE;
    try {
      process.env.STORYREEL_MAX_ACTIVE = "1";
      enqueueCanvas({ ...fixture(), id: "other" }, ["i"], "other");
      assert.throws(() => resumeCanvas("jobs", job.id), /上限/);
      process.env.STORYREEL_MAX_ACTIVE = "2";
      assert.equal(resumeCanvas("jobs", job.id).status, "running");
      const resumed = JSON.parse(
        db.prepare("SELECT document FROM generation_tasks WHERE id=?").get(job.id).document,
      );
      assert.equal(resumed.task.requestId, "kept-id");
      assert.equal(resumed.pollErrors, 0);
    } finally {
      if (old === undefined) delete process.env.STORYREEL_MAX_ACTIVE;
      else process.env.STORYREEL_MAX_ACTIVE = old;
    }
  }));
test("independent generation targets do not acquire false dependencies", () =>
  isolated(async () => {
    const project = {
      ...fixture(),
      nodes: [n("a", "image", { prompt: "A" }), n("b", "image", { prompt: "B" })],
      edges: [],
    };
    const jobs = enqueueCanvas(project, ["a", "b"], "independent");
    const db = getDatabase();
    const records = jobs.map((job) =>
      JSON.parse(
        db.prepare("SELECT document FROM generation_tasks WHERE id=?").get(job.id).document,
      ),
    );
    assert.deepEqual(records[1].dependencies, []);
  }));

test("first/last frame pipeline resumes both image tasks, submits resolved frames once and fills versioned results (mock provider)", () =>
  isolated(async () => {
    const { canvasResultPatch } = load("lib/generation/results.ts");
    let p = {
      ...fixture(),
      nodes: [n("v", "video", { scenePrompt: "pick up the key", seedanceDuration: 5 })],
      edges: [],
    };
    p.nodes.push(
      n("first", "image", { prompt: "key on bench" }),
      n("last", "image", { prompt: "key in hand" }),
    );
    p.edges = ["first", "last"].map((source, index) => ({
      id: source + "-edge",
      source,
      target: "v",
      data: { kind: "context", inputRole: index === 0 ? "first-frame" : "last-frame" },
    }));
    const calls = [];
    let submittedImages = 0;
    global.fetch = async (url, options = {}) => {
      const body = options.body && JSON.parse(options.body);
      calls.push({ url, body });
      if (url === "https://queue.fal.run/fal-ai/flux/schnell") {
        const id = "image-" + ++submittedImages;
        return Response.json({
          request_id: id,
          status_url: `https://queue.fal.run/${id}/status`,
          response_url: `https://queue.fal.run/${id}/result`,
        });
      }
      if (url.includes("seedance") && !url.includes("/requests/"))
        return Response.json({
          request_id: "video-1",
          status_url: "https://queue.fal.run/video-1/status",
          response_url: "https://queue.fal.run/video-1/result",
        });
      if (url.endsWith("/status")) return Response.json({ status: "COMPLETED" });
      if (url.includes("/image-") && url.endsWith("/result"))
        return Response.json({
          images: [{ url: `https://media.test/${url.includes("image-1") ? "first" : "last"}.png` }],
        });
      if (url.endsWith("/video-1/result"))
        return Response.json({ video: { url: "https://media.test/clip.mp4" } });
      if (url.startsWith("https://media.test/"))
        return new Response(
          url.endsWith(".png")
            ? Buffer.from([137, 80, 78, 71, url.includes("first") ? 1 : 2, 2, 3, 4])
            : await fs.readFile(path.join(__dirname, "fixtures/segment.mp4")),
        );
      throw Error("Unexpected " + url);
    };
    const jobs = enqueueCanvas(p, ["v"], "frames");
    assert.deepEqual(
      jobs.map((j) => j.nodeId),
      ["first", "last", "v"],
    );
    await canvasWorkerTick(p.id);
    closeDatabases(); // Resume the already submitted first image after restart.
    for (let i = 0; i < 12; i++) {
      ready();
      await canvasWorkerTick(p.id);
      if (canvasJobs(p.id).every((j) => j.status === "succeeded")) break;
    }
    const done = canvasJobs(p.id);
    assert.ok(
      done.every((j) => j.status === "succeeded"),
      JSON.stringify(done),
    );
    assert.equal(submittedImages, 2);
    const videos = calls.filter((c) => c.body && c.url.includes("seedance"));
    assert.equal(videos.length, 1);
    assert.ok(videos[0].body.image_url.startsWith("data:image/png;base64,"));
    assert.ok(videos[0].body.end_image_url.startsWith("data:image/png;base64,"));
    assert.notEqual(videos[0].body.image_url, videos[0].body.end_image_url);
    for (const job of done) {
      const patch = canvasResultPatch(p, job);
      assert.ok(patch);
      p = {
        ...p,
        nodes: p.nodes.map((n) =>
          n.id === job.nodeId ? { ...n, data: { ...n.data, ...patch } } : n,
        ),
      };
    }
    assert.ok(p.nodes.find((n) => n.id === "v").data.videoUrl.startsWith("/api/media/"));
    assert.ok(p.nodes.every((n) => n.data.generationVersions.length === 1));
    closeDatabases();
    assert.equal(canvasJobs(p.id).length, 3);
    assert.equal(getDatabase().prepare("SELECT count(*) AS n FROM generated_versions").get().n, 3);
  }));
