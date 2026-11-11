const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  load = require("./load-ts.cjs");
const { submitGatewayVideo, pollGatewayVideo, gatewayTask } = load("lib/server/gateway-video.ts");
const { getDatabase, closeDatabases } = load("lib/server/database.ts");
const { enqueueCanvas, canvasWorkerTick, canvasJobs } = load("lib/server/canvas-jobs.ts");
const names = [
  "VIDEO_BASE_URL",
  "VIDEO_MODEL",
  "VIDEO_API_KEY",
  "STORYREEL_DATA_DIR",
  "STORYREEL_GENERATION_MODE",
];
async function isolated(fn) {
  const before = Object.fromEntries(names.map((k) => [k, process.env[k]])),
    fetch = global.fetch,
    root = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-video-"));
  closeDatabases();
  for (const k of names) delete process.env[k];
  Object.assign(process.env, {
    VIDEO_BASE_URL: "https://gateway.test/yz/v1/videos/generations",
    VIDEO_MODEL: "doubao-seedance-2-5",
    VIDEO_API_KEY: "private-key",
    STORYREEL_DATA_DIR: root,
  });
  try {
    await fn();
  } finally {
    closeDatabases();
    global.fetch = fetch;
    for (const [k, v] of Object.entries(before))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    await fs.rm(root, { recursive: true, force: true });
  }
}
const project = () => ({
  id: "gateway-probe",
  name: "probe",
  nodes: [
    {
      id: "video",
      type: "video",
      position: { x: 0, y: 0 },
      data: {
        nodeType: "video",
        scenePrompt: "商品展示",
        seedanceMode: "text-to-video",
        seedanceDuration: 5,
        seedanceResolution: "720p",
      },
    },
  ],
  edges: [],
});
test("gateway submission matches observed curl contract and preserves the external task ID", () =>
  isolated(async () => {
    let count = 0;
    global.fetch = async (url, init) => {
      count++;
      assert.equal(url, process.env.VIDEO_BASE_URL);
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer private-key");
      assert.deepEqual(JSON.parse(init.body), {
        model: "doubao-seedance-2-5",
        generationMode: "text_to_video",
        prompt: "商品展示",
        durationSeconds: 5,
        aspectRatio: "16:9",
        resolution: "720p",
      });
      return Response.json({
        success: true,
        code: 200,
        data: { requestId: "http-request", taskId: "external-task" },
      });
    };
    const result = await submitGatewayVideo({ prompt: "商品展示", duration: 5 });
    assert.equal(result.state, "pending");
    assert.equal(result.task.requestId, "external-task");
    assert.equal(result.task.provider, "gateway");
    assert.equal(result.task.statusUrl, "https://gateway.test/yz/v1/videos/tasks/query");
    assert.equal(count, 1);
  }));
test("gateway validates conflicting inputs and malformed accepted responses without retrying", () =>
  isolated(async () => {
    let count = 0;
    global.fetch = async () => {
      count++;
      return Response.json({ success: true, code: 200, data: {} });
    };
    await assert.rejects(
      () => submitGatewayVideo({ prompt: "portrait", lastFrameUrl: "https://image.test/a.png" }),
      /首帧/,
    );
    assert.equal(count, 0);
    await assert.rejects(
      () =>
        submitGatewayVideo({
          prompt: "portrait",
          firstFrameUrl: "https://image.test/a.png",
          referenceVideoUrls: ["https://media.test/v.mp4"],
        }),
      /混用/,
    );
    assert.equal(count, 0);
    await assert.rejects(() => submitGatewayVideo({ prompt: "portrait", duration: -1 }));
    assert.equal(count, 0);
    await assert.rejects(() => submitGatewayVideo({ prompt: "portrait" }), /提交结果未知/);
    assert.equal(count, 1);
    global.fetch = async () =>
      Response.json({ success: false, message: "not supported", data: null });
    await assert.rejects(() => submitGatewayVideo({ prompt: "portrait" }), /业务失败/);
  }));
test("canvas gateway task reopens, polls the original ID, stores one version and never resubmits", () =>
  isolated(async () => {
    let submits = 0,
      queries = 0;
    global.fetch = async (url, init) => {
      if (url === process.env.VIDEO_BASE_URL) {
        submits++;
        return Response.json({ success: true, code: 200, data: { taskId: "external-one" } });
      }
      if (url.endsWith("/videos/tasks/query")) {
        queries++;
        assert.deepEqual(JSON.parse(init.body), { taskId: "external-one" });
        assert.equal(new Headers(init.headers).get("authorization"), null);
        return Response.json({
          success: true,
          code: 200,
          data: {
            taskId: "external-one",
            status: "SUCCESS",
            videos: [{ url: "https://media.test/clip.mp4" }],
          },
        });
      }
      if (url === "https://media.test/clip.mp4")
        return new Response(await fs.readFile(path.join(__dirname, "fixtures/segment.mp4")));
      throw Error("Unexpected URL " + url);
    };
    const [created] = enqueueCanvas(project(), ["video"], "request");
    await canvasWorkerTick("gateway-probe");
    assert.equal(submits, 1);
    closeDatabases();
    const db = getDatabase(),
      row = db.prepare("SELECT document FROM generation_tasks WHERE id=?").get(created.id),
      stored = JSON.parse(row.document);
    assert.equal(stored.providerTask.requestId, "external-one");
    stored.providerTask.statusUrl = "";
    stored.providerTask.blockedReason = "legacy";
    stored.nextRunAt = 0;
    db.prepare("UPDATE generation_tasks SET document=? WHERE id=?").run(
      JSON.stringify(stored),
      created.id,
    );
    await canvasWorkerTick("gateway-probe");
    const job = canvasJobs("gateway-probe")[0];
    assert.equal(submits, 1);
    assert.equal(queries, 1);
    assert.equal(job.id, created.id);
    assert.equal(job.status, "succeeded");
    assert.equal(job.waitingForQuery, false);
    assert.equal(job.url, "/api/media/" + created.id);
    assert.ok(job.fingerprint);
    assert.equal(db.prepare("SELECT count(*) AS n FROM generated_versions").get().n, 1);
    await canvasWorkerTick("gateway-probe");
    assert.equal(submits, 1);
    assert.equal(queries, 1);
  }));
test("adopting a real curl submission is atomic, idempotent and never calls the provider", () =>
  isolated(async () => {
    let count = 0;
    global.fetch = async (url) => {
      count++;
      assert.ok(url.endsWith("/videos/tasks/query"));
      return Response.json({
        success: true,
        code: 200,
        data: { taskId: "existing-task", status: "RUNNING" },
      });
    };
    const p = project(),
      task = gatewayTask("existing-task");
    const [first] = enqueueCanvas(p, ["video"], "adopt-existing", task),
      [again] = enqueueCanvas(p, ["video"], "adopt-existing", task);
    assert.deepEqual(JSON.parse(JSON.stringify(first)), again);
    closeDatabases();
    await canvasWorkerTick(p.id);
    assert.equal(count, 1);
    assert.equal(canvasJobs(p.id)[0].externalRequestId, "existing-task");
    assert.equal(canvasJobs(p.id).length, 1);
  }));

test("two existing local images become gateway materialList and Seedance 2.5 adaptive inputs", () =>
  isolated(async () => {
    const { storeGeneratedMedia } = load("lib/server/generated-media.ts");
    const { buildGatewayVideoRequest } = load("lib/server/gateway-video.ts");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    await storeGeneratedMedia("first", {
      state: "done",
      bytes: png,
      extension: "png",
      provider: "fixture",
    });
    await storeGeneratedMedia("last", {
      state: "done",
      bytes: Buffer.concat([png, Buffer.from("last")]),
      extension: "png",
      provider: "fixture",
    });
    const input = {
      prompt: "pick up key",
      mode: "first-last-frame",
      firstFrameUrl: "/api/media/first",
      lastFrameUrl: "/api/media/last",
      aspectRatio: "16:9",
      generateAudio: false,
    };
    assert.equal(buildGatewayVideoRequest(input).aspectRatio, "adaptive");
    global.fetch = async (url, init) => {
      assert.equal(url, process.env.VIDEO_BASE_URL);
      const body = JSON.parse(init.body);
      assert.equal(body.generationMode, "first_last_frame");
      assert.equal(body.aspectRatio, "adaptive");
      assert.equal(body.generateAudio, false);
      assert.deepEqual(
        body.materialList.map((m) => [m.type, m.role, m.mimeType]),
        [
          ["image", "first_frame", "image/png"],
          ["image", "last_frame", "image/png"],
        ],
      );
      assert.ok(body.materialList.every((m) => m.value.startsWith("data:image/png;base64,")));
      assert.notEqual(body.materialList[0].value, body.materialList[1].value);
      return Response.json({ success: true, code: 200, data: { taskId: "frames" } });
    };
    const result = await submitGatewayVideo(input);
    assert.equal(result.task.requestId, "frames");
  }));
test("query handles pending, failure, unknown, malformed output and foreign task IDs", () =>
  isolated(async () => {
    const task = gatewayTask("task");
    for (const status of ["PENDING", "RUNNING"]) {
      global.fetch = async () =>
        Response.json({ success: true, code: 200, data: { taskId: "task", status } });
      assert.equal((await pollGatewayVideo(task)).state, "pending");
    }
    for (const status of ["FAILED", "UNKNOWN"]) {
      global.fetch = async () =>
        Response.json({
          success: true,
          code: 200,
          data: { taskId: "task", status, error: { message: "private-key rejected" } },
        });
      await assert.rejects(
        () => pollGatewayVideo(task),
        (e) =>
          e instanceof load("lib/generation/lifecycle.ts").TerminalTaskError &&
          !e.message.includes("private-key"),
      );
    }
    global.fetch = async () =>
      Response.json({
        success: true,
        code: 200,
        data: { taskId: "other", status: "SUCCESS", videoUrl: "https://media.test/a.mp4" },
      });
    await assert.rejects(() => pollGatewayVideo(task), /不匹配/);
    global.fetch = async () =>
      Response.json({ success: true, code: 200, data: { taskId: "task", status: "SUCCESS" } });
    await assert.rejects(() => pollGatewayVideo(task), /视频地址/);
    global.fetch = () => {
      throw Error("must not send");
    };
    await assert.rejects(
      () => pollGatewayVideo({ ...task, statusUrl: "https://evil.test/query" }),
      /不匹配/,
    );
  }));
test("terminal provider states stop the worker immediately without querying or submitting again", () =>
  isolated(async () => {
    let submissions = 0,
      queries = 0;
    global.fetch = async (url) => {
      if (url === process.env.VIDEO_BASE_URL) {
        submissions++;
        return Response.json({ success: true, code: 200, data: { taskId: "failed-task" } });
      }
      queries++;
      return Response.json({
        success: true,
        code: 200,
        data: {
          taskId: "failed-task",
          status: "FAILED",
          error: { message: "upstream rejected input" },
        },
      });
    };
    const [job] = enqueueCanvas(project(), ["video"], "failure");
    await canvasWorkerTick("gateway-probe");
    const db = getDatabase(),
      stored = JSON.parse(
        db.prepare("SELECT document FROM generation_tasks WHERE id=?").get(job.id).document,
      );
    stored.nextRunAt = 0;
    db.prepare("UPDATE generation_tasks SET document=? WHERE id=?").run(
      JSON.stringify(stored),
      job.id,
    );
    await canvasWorkerTick("gateway-probe");
    assert.equal(canvasJobs("gateway-probe")[0].status, "failed");
    await canvasWorkerTick("gateway-probe");
    assert.equal(submissions, 1);
    assert.equal(queries, 1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM generated_versions").get().n, 0);
  }));
test("shot production uses the same gateway image submission and query adapter", () =>
  isolated(async () => {
    const { generationProvider } = load("lib/server/generation-provider.ts");
    const { storeGeneratedMedia } = load("lib/server/generated-media.ts");
    await storeGeneratedMedia("shot-image", {
      state: "done",
      bytes: Buffer.from([137, 80, 78, 71, 1, 2, 3, 4]),
      extension: "png",
      provider: "fixture",
    });
    const job = {
      id: "shot-video",
      kind: "video",
      inputImageId: "shot-image",
      shot: {
        shotId: "s",
        sceneId: "scene",
        duration: 5,
        action: "pick up key",
        imagePrompt: "rain station",
      },
    };
    let calls = 0;
    global.fetch = async (url, init) => {
      calls++;
      if (url === process.env.VIDEO_BASE_URL) {
        const body = JSON.parse(init.body);
        assert.equal(body.generationMode, "image_to_video");
        assert.equal(body.materialList[0].role, "first_frame");
        assert.ok(body.materialList[0].value.startsWith("data:image/png;base64,"));
        return Response.json({ success: true, code: 200, data: { taskId: "shot-task" } });
      }
      assert.ok(url.endsWith("/videos/tasks/query"));
      return Response.json({
        success: true,
        code: 200,
        data: { taskId: "shot-task", status: "SUCCESS", videoUrl: "https://media.test/shot.mp4" },
      });
    };
    const submitted = await generationProvider.submit(job);
    assert.equal(submitted.task.requestId, "shot-task");
    const done = await generationProvider.poll({ ...job, providerTask: submitted.task });
    assert.equal(done.state, "done");
    assert.equal(done.url, "https://media.test/shot.mp4");
    assert.equal(calls, 2);
  }));
