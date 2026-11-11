// Self-contained: isolated web server, worker and mock providers; no paid model calls.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const port = process.env.STORYREEL_TEST_PORT || "3192";
const base = `http://localhost:${port}`;
const authorization =
  "Basic " + Buffer.from("test-editor:isolated-test-password").toString("base64");
let temp,
  server,
  worker,
  browser,
  logs = "",
  env;
const errors = [];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, message, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await fn();
    if (result) return result;
    await delay(200);
  }
  throw new Error(message + "\n" + logs.slice(-3500));
}
function launch(command, args) {
  const child = spawn(command, args, { cwd: temp, env, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => {
      logs += data.toString();
    });
  return child;
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await until(
    () => child.exitCode !== null || child.signalCode !== null,
    "process did not stop",
    10000,
  );
}
async function api(route, body) {
  const response = await fetch(
    base + route,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json", authorization },
          body: JSON.stringify(body),
        }
      : { headers: { authorization } },
  );
  assert.ok(response.ok, route + ": " + (await response.clone().text()));
  return response.json();
}
async function state() {
  return api("/api/projects/shot-e2e/production");
}
function startWorker() {
  worker = launch(process.execPath, [
    path.join(root, "node_modules/tsx/dist/cli.mjs"),
    "scripts/generation-worker.ts",
  ]);
  return worker;
}
(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "storyreel-shot-e2e-"));
  for (const dir of ["app", "components", "lib", "stores", "scripts"])
    await fs.cp(path.join(root, dir), path.join(temp, dir), { recursive: true });
  for (const file of [
    "middleware.ts",
    "package.json",
    "tsconfig.json",
    "next-env.d.ts",
    "next.config.ts",
    "postcss.config.js",
    "tailwind.config.ts",
  ])
    await fs.copyFile(path.join(root, file), path.join(temp, file));
  await fs.mkdir(path.join(temp, "tests/fixtures"), { recursive: true });
  await fs.copyFile(
    path.join(root, "tests/fixtures/segment.mp4"),
    path.join(temp, "tests/fixtures/segment.mp4"),
  );
  await fs.symlink(path.join(root, "node_modules"), path.join(temp, "node_modules"), "dir");
  env = {
    ...process.env,
    STORYREEL_DATA_DIR: path.join(temp, ".data"),
    STORYREEL_GENERATION_MODE: "mock",
    STORYREEL_MOCK_DELAY_MS: "1500",
    STORYREEL_EDITOR_USER: "test-editor",
    STORYREEL_EDITOR_PASSWORD: "isolated-test-password",
  };
  server = launch(process.execPath, [
    path.join(root, "node_modules/next/dist/bin/next"),
    "dev",
    "-p",
    port,
  ]);
  await until(async () => {
    try {
      return (await fetch(base + "/api/projects", { headers: { authorization } })).ok;
    } catch {
      return false;
    }
  }, "web server did not start");
  startWorker();
  const now = new Date().toISOString();
  const shots = [
    {
      shotId: "shot-a",
      sceneId: "scene",
      shotIndex: 0,
      frameType: "中景",
      cameraMove: "push",
      lighting: "warm",
      action: "发现信件",
      dialogue: "你会相信这封信吗？",
      duration: 1,
      imagePrompt: "original letter prompt",
    },
    {
      shotId: "shot-b",
      sceneId: "scene",
      shotIndex: 1,
      frameType: "特写",
      cameraMove: "static",
      lighting: "cold",
      action: "打开信封",
      dialogue: "",
      duration: 1,
      imagePrompt: "close up of envelope",
    },
  ];
  const project = {
    id: "shot-e2e",
    name: "逐镜生产验收",
    createdAt: now,
    updatedAt: now,
    startNodeId: "video_scene",
    nodes: [
      {
        id: "video_scene",
        type: "video",
        position: { x: 0, y: 0 },
        data: { nodeType: "video", title: "发现秘密" },
      },
      {
        id: "end",
        type: "ending",
        position: { x: 400, y: 0 },
        data: { nodeType: "ending", title: "镜头播放完成" },
      },
    ],
    edges: [{ id: "ve", source: "video_scene", target: "end", data: { kind: "flow" } }],
    creation: {
      activeStep: "storyboard",
      stepStatuses: {
        story: "done",
        branch: "done",
        storyboard: "done",
        visual: "idle",
        video: "idle",
        validate: "idle",
      },
      userPrompt: "a story",
      storyOutline: {
        title: "逐镜生产验收",
        description: "",
        genre: "悬疑",
        characters: [],
        scenes: [
          {
            id: "scene",
            title: "发现秘密",
            description: "",
            scenePrompt: "scene-level prompt must not drive production",
            order: 0,
          },
        ],
      },
      branchDesign: null,
      storyboardShots: shots,
      assets: [],
      assetLibrary: [],
    },
  };
  await api("/api/projects", project);
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const executablePath =
    process.env.CHROME_PATH ||
    (await fs.access(mac).then(
      () => mac,
      () => undefined,
    ));
  browser = await chromium.launch({ headless: true, executablePath });
  const creator = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    httpCredentials: { username: "test-editor", password: "isolated-test-password" },
  });
  const page = await creator.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/editor/shot-e2e#creation:storyboard");
  await page
    .getByRole("textbox", { name: "shot-a 画面提示词" })
    .fill("edited cinematic letter prompt");
  await page
    .getByRole("navigation", { name: "创作流程" })
    .getByRole("button", { name: /视频生成/ })
    .click();
  await page.getByRole("button", { name: "生成缺失镜头素材", exact: true }).click();
  let queued = await until(async () => {
    const s = await state();
    return s.jobs.some((j) => j.stage === "polling") ? s : false;
  }, "no durable external task recorded");
  const first = queued.jobs.find((j) => j.stage === "polling");
  const count = queued.jobs.length;
  assert.equal(
    queued.jobs.find((j) => j.shotId === "shot-a").shot.imagePrompt,
    "edited cinematic letter prompt",
  );
  await stop(worker);
  worker = null;
  await page.reload();
  await page.getByRole("button", { name: "创作", exact: true }).click();
  await page.getByRole("heading", { name: "视频生成", exact: true }).waitFor();
  const restored = await state();
  assert.equal(restored.jobs.length, count);
  assert.equal(
    restored.jobs.find((j) => j.id === first.id).providerTask.requestId,
    first.providerTask.requestId,
  );
  console.log("PASS: refresh restores the same durable task and its original shot prompt");
  startWorker();
  const finished = await until(async () => {
    const s = await state();
    return s.jobs.length === 5 && s.jobs.every((j) => j.status === "succeeded") ? s : false;
  }, "generation did not finish");
  assert.equal(finished.assets.length, 5);
  assert.equal(finished.assets.filter((a) => a.shotId === "shot-b").length, 2);
  console.log(
    "PASS: worker restart resumes polling, creates image/audio/video versions and respects silent shots",
  );
  await page.getByRole("button", { name: /角色与画面/ }).click();
  const firstImage = finished.assets.find((a) => a.shotId === "shot-a" && a.kind === "image");
  await until(
    async () =>
      page
        .locator('[data-shot-id="shot-a"]')
        .getByRole("img")
        .evaluate(
          (image) =>
            image.complete && image.naturalWidth > 0 && !image.currentSrc.includes("/_next/image"),
        )
        .catch(() => false),
    "authenticated shot preview did not render from its original media URL",
  );
  await page
    .locator('[data-shot-id="shot-a"]')
    .getByRole("button", { name: "重新生成图片", exact: true })
    .click();
  const regenerated = await until(async () => {
    const s = await state();
    return s.assets.filter((a) => a.shotId === "shot-a" && a.kind === "image").length === 2
      ? s
      : false;
  }, "single image regeneration failed");
  assert.equal(regenerated.assets.filter((a) => a.shotId === "shot-b").length, 2);
  const versionSelect = page.getByRole("combobox", { name: "shot-a 图片版本" });
  await until(
    async () => await versionSelect.textContent().then((text) => text.startsWith("v2 ·")),
    "latest image version did not reach UI",
  );
  await versionSelect.click();
  await page.getByRole("option", { name: /^v1 ·/ }).click();
  await until(
    async () => (await state()).selected["shot-a"].image === firstImage.id,
    "version replacement was not saved",
  );
  await page.reload();
  await page.getByRole("button", { name: "创作", exact: true }).click();
  await until(
    async () =>
      await page
        .getByRole("combobox", { name: "shot-a 图片版本" })
        .textContent()
        .then((text) => text.startsWith("v1 ·"))
        .catch(() => false),
    "selected historical version did not survive reload",
  );
  console.log(
    "PASS: single-shot regeneration preserves other shots and historical version selection survives reload",
  );
  await page
    .getByRole("navigation", { name: "创作流程" })
    .getByRole("button", { name: /视频生成/ })
    .click();
  await page.getByRole("button", { name: "将选中版本应用到剧情", exact: true }).click();
  await page.getByText("已应用到剧情", { exact: true }).waitFor();
  const applied = await api("/api/projects/shot-e2e");
  assert.equal(applied.nodes[0].data.segments.length, 2);
  assert.ok(applied.nodes[0].data.segments[0].audioUrl);
  await page.getByRole("button", { name: "发布", exact: true }).click();
  await page.getByRole("button", { name: "开始校验", exact: true }).click();
  await page.getByRole("button", { name: "发布互动视频", exact: true }).click();
  await page.locator("#story-share-link").waitFor();
  const shareLink = await page.locator("#story-share-link").inputValue();
  const viewer = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await viewer.addInitScript(() => {
    window.played = [];
    document.addEventListener(
      "play",
      (event) => {
        if (event.target instanceof HTMLMediaElement)
          window.played.push({ tag: event.target.tagName, src: event.target.getAttribute("src") });
      },
      true,
    );
  });
  const watch = await viewer.newPage();
  watch.on("pageerror", (e) => errors.push(e.message));
  await watch.goto(shareLink);
  await watch.locator("video").waitFor();
  await watch.locator("video").evaluate((v) => {
    v.muted = true;
    return v.play();
  });
  await watch
    .getByRole("heading", { name: "镜头播放完成", exact: true })
    .waitFor({ timeout: 20000 });
  const played = await watch.evaluate(() => window.played);
  assert.ok(
    applied.nodes[0].data.segments.every((s) =>
      played.some((p) => p.tag === "VIDEO" && p.src === s.videoUrl),
    ),
    JSON.stringify(played),
  );
  assert.ok(
    played.some((p) => p.tag === "AUDIO"),
    JSON.stringify(played),
  );
  assert.equal(await watch.evaluate(() => localStorage.length), 0);
  assert.equal((await fetch(base + "/api/projects")).status, 401);
  assert.equal((await fetch(base + firstImage.url)).status, 401);
  console.log("PASS: anonymous viewers cannot access editor data or unpublished images");
  console.log(
    "PASS: published scene plays both generated shot versions and the selected voice track in an empty browser",
  );
  await fs.mkdir(path.join(root, "tests/artifacts"), { recursive: true });
  await page.screenshot({ path: path.join(root, "tests/artifacts/shot-production.png") });
  // Restart the web process as well: stored media and published shot references remain valid.
  await stop(server);
  server = launch(process.execPath, [
    path.join(root, "node_modules/next/dist/bin/next"),
    "dev",
    "-p",
    port,
  ]);
  await until(async () => {
    try {
      return (await fetch(base + "/api/projects", { headers: { authorization } })).ok;
    } catch {
      return false;
    }
  }, "server restart failed");
  const media = await fetch(base + applied.nodes[0].data.segments[0].videoUrl, {
    headers: { range: "bytes=0-31" },
  });
  assert.equal(media.status, 206);
  await watch.goto(shareLink);
  await watch.locator("video").waitFor();
  await watch.locator("video").evaluate((v) => {
    v.muted = true;
    return v.play();
  });
  await watch
    .getByRole("heading", { name: "镜头播放完成", exact: true })
    .waitFor({ timeout: 20000 });
  assert.deepEqual(errors, []);
  console.log("PASS: server restart preserves generated media and the public playback snapshot");
  if (process.env.STORYREEL_E2E_BUILD === "1") {
    await stop(server);
    server = null;
    await stop(worker);
    worker = null;
    const build = launch(process.execPath, [
      path.join(root, "node_modules/next/dist/bin/next"),
      "build",
    ]);
    await until(() => build.exitCode !== null, "production build did not finish", 120000);
    assert.equal(build.exitCode, 0, logs.slice(-5000));
    console.log("PASS: isolated production build");
  }
  console.log("All shot production browser checks passed");
})()
  .catch(async (error) => {
    const failedPage=browser?.contexts()[0]?.pages()[0];
    if(failedPage){
      console.error("PAGE STATE:",(await failedPage.locator("body").innerText().catch(()=>"unavailable")).slice(0,4000));
      await fs.mkdir(path.join(root,"tests/artifacts"),{recursive:true});
      await failedPage.screenshot({path:path.join(root,"tests/artifacts/shot-production-failure.png")}).catch(()=>{});
    }
    console.error(error);
    console.error(logs.slice(-4500));
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    await stop(worker).catch(() => {});
    await stop(server).catch(() => {});
    if (temp) await fs.rm(temp, { recursive: true, force: true });
  });
