// Isolated UI regression: uploads, entry points, variables, backups and publication management.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  port = "3194",
  base = `http://localhost:${port}`;
let temp,
  server,
  browser,
  auditPage,
  logs = "";
const errors = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, message, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return;
    await delay(150);
  }
  throw Error(message);
}
async function api(route, body) {
  const response = await fetch(
    base + route,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  assert.ok(response.ok, route + ": " + (await response.clone().text()));
  return response.json();
}
(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "storyreel-functional-ui-"));
  for (const dir of ["app", "components", "lib", "stores", "public"])
    await fs.cp(path.join(root, dir), path.join(temp, dir), { recursive: true });
  for (const file of [
    "package.json",
    "tsconfig.json",
    "next-env.d.ts",
    "next.config.ts",
    "postcss.config.js",
    "tailwind.config.ts",
  ])
    await fs.copyFile(path.join(root, file), path.join(temp, file));
  await fs.symlink(path.join(root, "node_modules"), path.join(temp, "node_modules"), "dir");
  server = spawn(
    process.execPath,
    [path.join(root, "node_modules/next/dist/bin/next"), "dev", "-p", port],
    {
      cwd: temp,
      env: { ...process.env, STORYREEL_DATA_DIR: path.join(temp, ".data") },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [server.stdout, server.stderr])
    stream.on("data", (chunk) => (logs += chunk.toString()));
  await until(
    async () => {
      try {
        return (await fetch(base + "/api/projects")).ok;
      } catch {
        return false;
      }
    },
    "server did not start",
    60000,
  );
  // The first cold Next dev response can race the webpack chunk write. Compile before opening the browser.
  await fetch(base);
  await until(async () => {
    try {
      const response = await fetch(base + "/_next/static/chunks/app/layout.js");
      if (!response.ok) return false;
      new (require("node:vm").Script)(await response.text());
      return true;
    } catch {
      return false;
    }
  }, "layout chunk did not finish compiling");
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_PATH ||
      (await fs.access(chrome).then(
        () => chrome,
        () => undefined,
      )),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  auditPage = page;
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  // All AI responses are fixtures; this suite cannot make a paid generation call.
  await page.route("**/api/ai/**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "测试中禁止调用真实模型" }),
    }),
  );
  const configured = page.waitForResponse(
    (response) => response.url().endsWith("/api/config/check"),
    { timeout: 20000 },
  );
  await page.goto(base);
  await configured;
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  await page.getByText("还没有素材", { exact: true }).waitFor();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await page
    .getByLabel("选择素材文件")
    .setInputFiles({ name: "真实上传.png", mimeType: "image/png", buffer: png });
  await page.getByText("真实上传.png", { exact: true }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  await page.getByText("真实上传.png", { exact: true }).waitFor();
  await until(
    async () =>
      page
        .getByRole("img", { name: "真实上传.png", exact: true })
        .evaluate(
          (image) =>
            image.complete && image.naturalWidth > 0 && !image.currentSrc.includes("/_next/image"),
        )
        .catch(() => false),
    "uploaded image did not render from its original media URL",
  );
  console.log("PASS: actual uploads persist and replace the mock asset library");
  await page.getByRole("button", { name: "工作台", exact: true }).click();
  await page.getByRole("button", { name: "角色", exact: true }).click();
  await page.getByRole("textbox", { name: "故事创意" }).fill("雨中的女孩，红色外套");
  await page.getByRole("button", { name: "开始创作", exact: true }).click();
  await until(async () => {
    if (page.url().includes("/editor/")) return true;
    const enter = page.getByRole("button", { name: "仍然进入", exact: true });
    if (await enter.isVisible()) await enter.click();
    return false;
  }, "character tool did not open");
  await page.locator(".react-flow__node").getByText("角色参考", { exact: true }).click();
  assert.equal(
    await page.getByPlaceholder("描述想要生成的图片...").inputValue(),
    "雨中的女孩，红色外套",
  );
  await page.route("**/api/canvas/jobs", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    return route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "provider unavailable" }),
    });
  });
  await page.getByRole("button", { name: "✦ AI 生成图片", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "provider unavailable" }).waitFor();
  console.log(
    "PASS: character prompts survive navigation and failed images are reported as failures",
  );
  const form = new FormData();
  form.append(
    "file",
    new File([await fs.readFile(path.join(root, "tests/fixtures/segment.mp4"))], "story.mp4", {
      type: "video/mp4",
    }),
  );
  const video = await (await fetch(base + "/api/assets", { method: "POST", body: form })).json();
  assert.ok(video.url);
  const now = new Date().toISOString();
  const n = (id, type, x, y, data = {}) => ({
    id,
    type,
    position: { x, y },
    data: { nodeType: type, title: id, ...data },
  });
  const e = (id, source, target, data = {}) => ({
    id,
    source,
    target,
    data: { kind: "flow", ...data },
  });
  const p = {
    id: "functional-ui",
    name: "条件与备份验收",
    createdAt: now,
    updatedAt: now,
    startNodeId: "video_old",
    initialVariables: { trust: 0 },
    nodes: [
      n("video_old", "video", 0, 100, { videoUrl: video.url }),
      n("choice", "choice", 350, 100, { question: "你相信他吗？" }),
      n("condition", "condition", 700, -180, { variable: "trust", operator: ">=", value: 2 }),
      n("yes", "ending", 1050, -180, { title: "信任结局" }),
      n("no", "ending", 1050, 350, { title: "拒绝结局" }),
    ],
    edges: [
      e("vc", "video_old", "choice"),
      e("accept", "choice", "condition", { choiceLabel: "相信" }),
      e("refuse", "choice", "no", { choiceLabel: "拒绝" }),
      e("yes", "condition", "yes", { condition: "true" }),
      e("no", "condition", "no", { condition: "false" }),
    ],
    creation: {
      activeStep: "story",
      stepStatuses: {
        story: "done",
        branch: "done",
        storyboard: "idle",
        visual: "idle",
        video: "done",
        validate: "idle",
      },
      userPrompt: "old idea",
      storyOutline: {
        title: "旧故事",
        description: "old",
        genre: "悬疑",
        characters: [],
        scenes: [
          { id: "old", title: "旧场景", description: "old", scenePrompt: "old prompt", order: 0 },
        ],
      },
      branchDesign: null,
      storyboardShots: [],
      assets: [],
      assetLibrary: [],
    },
  };
  await api("/api/projects", p);
  await page.goto(base + "/editor/functional-ui#canvas");
  await page.getByRole("button", { name: "剧情变量", exact: true }).click();
  await page.getByRole("textbox", { name: "初始变量", exact: true }).fill('{"trust": 1}');
  await page.getByRole("button", { name: "保存变量", exact: true }).click();
  await page.getByRole("button", { name: "关闭剧情变量", exact: true }).click();
  await page.locator('.react-flow__edge[data-id="accept"] .react-flow__edge-textbg').click();
  await page
    .getByRole("textbox", { name: "经过这条路线后设置变量", exact: true })
    .fill('{"trust": 2}');
  await page.getByRole("button", { name: "保存变量", exact: true }).click();
  await page.getByRole("button", { name: "添加文字节点", exact: true }).click();
  assert.equal(await page.locator(".react-flow__node").count(), 6);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert.equal(await page.locator(".react-flow__node").count(), 5);
  // Variable edits invalidate media inputs; explicitly reuse the uploaded clip before publishing.
  await page
    .locator('.react-flow__node[data-id="video_old"]')
    .getByText("video_old", { exact: true })
    .click();
  await page.getByText("使用已有视频或配音", { exact: true }).click();
  await page
    .getByRole("listitem")
    .filter({ has: page.locator(`video[src="${video.url}"]`) })
    .getByRole("button", { name: "使用素材", exact: true })
    .click();

  await page.getByRole("button", { name: "发布", exact: true }).click();
  await page.getByRole("button", { name: "开始校验", exact: true }).click();
  await page.getByRole("button", { name: "发布互动视频", exact: true }).click();
  await page.locator("#story-share-link").waitFor();
  const link = await page.locator("#story-share-link").inputValue();
  const viewer = await browser.newContext(),
    watch = await viewer.newPage();
  watch.on("pageerror", (error) => errors.push(error.message));
  await watch.goto(link);
  await watch.locator("video").waitFor();
  await watch.locator("video").evaluate((v) => {
    v.muted = true;
    return v.play();
  });
  await watch.getByRole("button", { name: "A 相信", exact: true }).click();
  await watch.getByRole("heading", { name: "信任结局", exact: true }).waitFor();
  console.log(
    "PASS: variables and edge assignments edited in the UI reach the correct published ending; undo restores deleted work",
  );
  await page.reload();
  await page.getByRole("button", { name: "发布", exact: true }).click();
  await page.getByRole("link", { name: p.name, exact: true }).waitFor();
  await page.getByRole("button", { name: "撤回", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "撤回", exact: true }).click();
  await until(
    async () => (await fetch(base + "/api/publications/" + link.split("/").pop())).status === 404,
    "publication was not revoked",
  );
  console.log("PASS: published links can be recovered after reload and revoked");
  const outline = {
    title: "新故事",
    description: "new",
    genre: "悬疑",
    characters: [],
    scenes: [
      { id: "new", title: "新场景", description: "new", scenePrompt: "new prompt", order: 0 },
    ],
  };
  await page.route("**/api/ai/script", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(outline),
    }),
  );
  await page.getByRole("button", { name: /故事与剧本/ }).click();
  await page.getByRole("button", { name: "重新生成故事大纲", exact: true }).click();
  await page.getByRole("heading", { name: "新故事", exact: true }).first().waitFor();
  const staged = await api("/api/projects/functional-ui");
  assert.ok(staged.nodes.some((n) => n.id === "video_old"));
  assert.equal(staged.creation.storyOutline.title, "旧故事");
  await page.getByRole("button", { name: "应用到剧情画布，进入分支设计 →", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "备份并应用", exact: true })
    .click();
  await page.getByRole("heading", { name: "分支剧情", exact: true }).waitFor();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已保存" }).waitFor();
  await until(
    async () =>
      (await api("/api/projects")).some(
        (p) => p.id.startsWith("backup_") && p.nodes.some((n) => n.id === "video_old"),
      ),
    "original story backup is missing",
  );
  const applied = await api("/api/projects/functional-ui");
  assert.equal(applied.creation.storyboardShots.length, 0);
  assert.equal(applied.creation.stepStatuses.video, "idle");
  await page.getByRole("button", { name: "画布", exact: true }).click();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.locator('.react-flow__node[data-id="video_old"]').waitFor();
  console.log(
    "PASS: new outlines are staged safely, applying creates a persistent backup and undo restores the original graph",
  );
  await fs.mkdir(path.join(root, "tests/artifacts"), { recursive: true });
  await page.screenshot({ path: path.join(root, "tests/artifacts/functional-canvas.png") });
  assert.deepEqual(errors, []);
  console.log("All functional UI checks passed");
})()
  .catch(async (error) => {
    console.error(error);
    console.error("page errors", errors);
    if (auditPage) {
      for (const [i, source] of (
        await auditPage.locator("script:not([src])").allTextContents()
      ).entries()) {
        try {
          new (require("node:vm").Script)(source);
        } catch (error) {
          console.error("inline script", i, error);
          await fs.writeFile("/tmp/storyreel-inline-bad.js", source);
        }
      }
    }
    if (auditPage)
      console.error(
        (
          await auditPage
            .locator("body")
            .innerText()
            .catch(() => "")
        ).slice(0, 2500),
      );
    console.error(logs.slice(-3500));
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await until(
        () => server.exitCode !== null || server.signalCode !== null,
        "server did not stop",
      ).catch(() => {});
    }
    if (temp) await fs.rm(temp, { recursive: true, force: true });
  });
