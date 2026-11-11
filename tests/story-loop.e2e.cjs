// Run `npm run dev`, then `npm run test:e2e` in another terminal.
// Set CHROME_PATH for a custom browser or install one with `npx playwright install chromium`.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const base = process.env.STORYREEL_TEST_URL || "http://localhost:3000";
const root = path.resolve(__dirname, "..");
const id = `e2e_${Date.now()}`;
const mediaPath = `/storyreel-${id}.mp4`;
const outline = {
  title: "确定性互动回归",
  description: "",
  genre: "悬疑",
  characters: [],
  scenes: ["intro", "a", "b", "c"].map((id, order) => ({
    id,
    title: `场景 ${id}`,
    description: "",
    scenePrompt: "fixture prompt",
    order,
  })),
};
const design = {
  decisionPoints: [
    {
      sceneId: "a",
      question: "你会打开信件吗？",
      choices: [
        { label: "打开信件", targetSceneId: "b", consequence: "发现真相" },
        { label: "立即离开", targetSceneId: "c", consequence: "错过线索" },
      ],
    },
  ],
  endings: [
    { sceneId: "b", title: "真相结局", description: "你找到了答案" },
    { sceneId: "c", title: "离开结局", description: "你选择了离开" },
  ],
};
const now = new Date().toISOString();
const project = {
  id,
  name: outline.title,
  createdAt: now,
  updatedAt: now,
  startNodeId: "video_intro",
  nodes: outline.scenes.flatMap((scene, i) => [
    {
      id: `video_${scene.id}`,
      type: "video",
      position: { x: i * 320, y: 0 },
      data: {
        nodeType: "video",
        title: scene.title,
        videoUrl: mediaPath,
        duration: 1.2,
        scenePrompt: "private prompt",
      },
    },
    {
      id: `ending_${scene.id}`,
      type: "ending",
      position: { x: i * 320, y: 260 },
      data: { nodeType: "ending", title: "旧结局" },
    },
  ]),
  edges: outline.scenes.map((scene) => ({
    id: `old_${scene.id}`,
    source: `video_${scene.id}`,
    target: `ending_${scene.id}`,
    data: { kind: "flow" },
  })),
  creation: {
    activeStep: "branch",
    stepStatuses: {
      story: "done",
      branch: "idle",
      storyboard: "idle",
      visual: "idle",
      video: "idle",
      validate: "idle",
    },
    userPrompt: "保存的创意",
    storyOutline: outline,
    branchDesign: null,
    storyboardShots: [],
    assets: [],
    assetLibrary: [],
  },
};
let browser, publicationId;
const extraPublications = [];
const failures = [];
async function api(url, options) {
  const response = await fetch(base + url, options);
  assert.ok(response.ok, `${url}: ${response.status} ${await response.clone().text()}`);
  return response.status === 204 ? null : response.json();
}
async function playIfBlocked(page) {
  const start = page.getByRole("button", { name: "开始观看", exact: true });
  // Trigger playback through an actual click to satisfy browser autoplay policies.
  await page.locator("video").waitFor();
  await page.locator("video").evaluate((video) => (video.muted = true));
  await page.locator("video").click({ position: { x: 30, y: 30 } });
  if (await start.isVisible()) await start.click();
  await page.locator("video").evaluate((video) => video.play());
}
(async () => {
  await fs.mkdir(path.join(root, "public"), { recursive: true });
  await fs.copyFile(
    path.join(__dirname, "fixtures/segment.mp4"),
    path.join(root, "public", mediaPath.slice(1)),
  );
  await api("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project),
  });
  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const installedChrome = await fs.access(macChrome).then(
    () => macChrome,
    () => undefined,
  );
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || installedChrome,
  });
  const creator = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await creator.newPage();
  page.on("pageerror", (error) => failures.push(error.message));
  await page.route("**/api/ai/branch-agent", (route) =>
    route.fulfill({ contentType: "text/plain", body: JSON.stringify(design) }),
  );
  await page.goto(`${base}/editor/${id}#creation:branch`);
  await page.getByRole("button", { name: "生成分支方案", exact: true }).click();
  await page.getByRole("heading", { name: "你会打开信件吗？", exact: true }).waitFor();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已保存" }).waitFor();
  const first = await api(`/api/projects/${id}`);
  assert.equal(
    first.nodes.find((n) => n.id === "choice_a").data.question,
    design.decisionPoints[0].question,
  );
  assert.equal(first.creation.userPrompt, "保存的创意");
  await page.getByRole("button", { name: "重新生成分支", exact: true }).click();
  await page.getByRole("heading", { name: "你会打开信件吗？", exact: true }).waitFor();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已保存" }).waitFor();
  const repeated = await api(`/api/projects/${id}`);
  assert.equal(repeated.edges.length, first.edges.length);
  console.log("PASS: AI branch application is complete and repeatable");
  await page.getByRole("button", { name: "画布", exact: true }).click();
  await page
    .locator('.react-flow__node[data-id="video_a"]')
    .getByText("场景 a", { exact: true })
    .click();
  await page.getByRole("button", { name: "片段属性", exact: true }).click();
  await page.getByRole("textbox", { name: "片段标题", exact: true }).fill("已编辑的决策片段");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已保存" }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "画布", exact: true }).waitFor();
  await page
    .locator('.react-flow__node[data-id="video_a"]')
    .getByText("已编辑的决策片段", { exact: true })
    .waitFor();
  await page.goto(base);
  await page.getByRole("button", { name: "继续编辑 确定性互动回归", exact: true }).click();
  await page
    .locator('.react-flow__node[data-id="video_a"]')
    .getByText("已编辑的决策片段", { exact: true })
    .waitFor();
  console.log("PASS: editor refresh and dashboard reopen preserve the latest edits");
  // These clips are imported fixtures. Re-baseline them after changing the story routes
  // so the production stale-input guard remains enabled in the application.
  const { baselineMedia } = require("./load-ts.cjs")("lib/canvas/workflow.ts");
  const fixtureDraft = await api(`/api/projects/${id}`);
  fixtureDraft.nodes = fixtureDraft.nodes.map((n) => ({
    ...n,
    data: { ...n.data, generationFingerprint: undefined },
  }));
  fixtureDraft.updatedAt = new Date().toISOString();
  await api("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(baselineMedia(fixtureDraft)),
  });
  await page.reload();
  await page.getByRole("button", { name: "发布", exact: true }).waitFor();
  await page.getByRole("button", { name: "发布", exact: true }).click();
  await page.getByRole("button", { name: "开始校验", exact: true }).click();
  await page.getByRole("heading", { name: "校验通过，可以发布", exact: true }).waitFor();
  await page.getByRole("button", { name: "发布互动视频", exact: true }).click();
  const input = page.locator("#story-share-link");
  await input.waitFor();
  const link = await input.inputValue();
  publicationId = new URL(link).pathname.split("/").pop();
  assert.equal(new URL(link).pathname, `/player/${publicationId}`);
  const published = await api(`/api/publications/${publicationId}`);
  assert.equal(published.project.creation, undefined);
  assert.equal(published.project.nodes.find((n) => n.id === "video_a").data.scenePrompt, undefined);
  console.log("PASS: publishing creates an immutable playback snapshot");
  // A new browser context has no cookies or localStorage from the creator.
  const viewer = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const watch = await viewer.newPage();
  watch.on("pageerror", (error) => failures.push(error.message));
  await watch.goto(link);
  assert.equal(await watch.evaluate(() => localStorage.length), 0);
  await playIfBlocked(watch);
  await watch.getByRole("button", { name: "A 打开信件" }).waitFor({ timeout: 15000 });
  assert.ok(await watch.getByText("你会打开信件吗？", { exact: true }).isVisible());
  await fs.mkdir(path.join(root, "tests/artifacts"), { recursive: true });
  await watch.screenshot({ path: path.join(root, "tests/artifacts/public-choice.png") });
  await watch.getByRole("button", { name: "A 打开信件" }).click();
  await watch.getByRole("heading", { name: "真相结局", exact: true }).waitFor({ timeout: 10000 });
  console.log(
    "PASS: real video ended events automatically advance through the intro and stop at a choice",
  );
  await watch.getByRole("button", { name: "重新体验", exact: true }).click();
  await watch.getByRole("button", { name: "B 立即离开" }).click({ timeout: 15000 });
  await watch.getByRole("heading", { name: "离开结局", exact: true }).waitFor({ timeout: 10000 });
  console.log("PASS: both branches play reused video URLs and reach their own endings");
  await watch.reload();
  await playIfBlocked(watch);
  await watch.getByRole("button", { name: "A 打开信件" }).waitFor({ timeout: 15000 });
  console.log("PASS: direct public link reload works without editor cache");
  // Editing the draft after publication cannot change an existing share link.
  const changed = await api(`/api/projects/${id}`);
  changed.name = "发布后的草稿修改";
  changed.nodes.find((n) => n.id === "ending_b").data.title = "新的草稿结局";
  await api("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changed),
  });
  const still = await api(`/api/publications/${publicationId}`);
  assert.equal(still.project.name, "确定性互动回归");
  assert.equal(still.project.nodes.find((n) => n.id === "ending_b").data.title, "真相结局");
  const timed = structuredClone(published.project);
  timed.nodes.find((n) => n.id === "video_a").data.interactionAt = 0.3;
  timed.nodes.find((n) => n.id === "choice_a").data.timeoutSecs = 1;
  timed.revision = (await api(`/api/projects/${id}`)).revision;
  const savedTimed = await api("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(timed),
  });
  timed.revision = savedTimed.revision;
  const timedPublication = await api(`/api/projects/${id}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(timed),
  });
  extraPublications.push(timedPublication.id);
  await watch.goto(base + timedPublication.path);
  await playIfBlocked(watch);
  await watch.getByRole("button", { name: "A 打开信件" }).waitFor({ timeout: 15000 });
  const stoppedAt = await watch.locator("video").evaluate((video) => video.currentTime);
  assert.ok(stoppedAt < 0.95, `choice must pause before the end, got ${stoppedAt}`);
  await watch.getByRole("heading", { name: "真相结局", exact: true }).waitFor({ timeout: 10000 });
  console.log(
    "PASS: a mid-video interaction pauses before ended and the timeout selects the default branch",
  );
  const broken = structuredClone(changed);
  broken.nodes.find((n) => n.id === "video_a").data.videoUrl = "blob:local-only";
  let rejected = await fetch(`${base}/api/projects/${id}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(broken),
  });
  assert.equal(rejected.status, 422);
  broken.nodes.find((n) => n.id === "video_a").data.videoUrl = mediaPath;
  broken.edges.push({
    id: "cycle",
    source: "ending_b",
    target: "video_intro",
    data: { kind: "flow" },
  });
  rejected = await fetch(`${base}/api/projects/${id}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(broken),
  });
  assert.equal(rejected.status, 422);
  assert.deepEqual(failures, []);
  console.log("PASS: stale-draft isolation and server-side validation reject invalid publishing");
  console.log(
    JSON.stringify({
      result: "all browser checks passed",
      publicationPath: `/player/${publicationId}`,
    }),
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    await fs.rm(path.join(root, "public", mediaPath.slice(1)), { force: true });
    await fetch(`${base}/api/projects/${id}`, { method: "DELETE" }).catch(() => {});
    for (const publication of [publicationId, ...extraPublications].filter(Boolean))
      await fetch(`${base}/api/projects/${id}/publications?publicationId=${publication}`, {
        method: "DELETE",
      }).catch(() => {});
  });
