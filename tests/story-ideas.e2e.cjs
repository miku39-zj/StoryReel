// Browser verification with intercepted project storage and AI responses; no real generation or writes.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const base = process.env.STORYREEL_TEST_URL || "http://127.0.0.1:3000";
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const now = new Date().toISOString(),
      brief = {
        mode: "interactive",
        genre: "奇幻",
        narrativeStyle: "电影叙事",
        decisionPoints: 2,
        allowCycles: false,
        references: [],
      };
    let project = {
      id: "ideas-check",
      name: "未命名项目",
      nodes: [],
      edges: [],
      createdAt: now,
      updatedAt: now,
      revision: 0,
      creation: {
        brief,
        activeStep: "story",
        userPrompt: "蝎子精",
        stepStatuses: {
          story: "idle",
          branch: "idle",
          storyboard: "idle",
          visual: "idle",
          video: "idle",
          validate: "idle",
        },
        storyOutline: null,
        branchDesign: null,
        storyboardShots: [],
        assets: [],
        assetLibrary: [],
      },
    };
    const outline = {
      title: "荒寺来客",
      description: "蝎子精在月下荒寺寻找失踪的故人。",
      genre: "奇幻",
      characters: [{ name: "蝎子精", role: "主角", description: "红衣，执着寻找真相。" }],
      scenes: [
        {
          id: "a",
          title: "荒寺",
          description: "发现线索",
          scenePrompt: "temple",
          order: 0,
          choices: [{ label: "继续", leadsTo: "b" }],
        },
        {
          id: "b",
          title: "破晓",
          description: "解开真相",
          scenePrompt: "sunrise",
          order: 1,
          choices: [],
        },
      ],
    };
    let fail = false,
      ideaCalls = 0;
    await page.route("**/api/projects**", async (r) => {
      if (r.request().method() === "POST") {
        project = { ...r.request().postDataJSON(), revision: project.revision + 1 };
      }
      const u = r.request().url();
      await r.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          u.includes("/publications")
            ? []
            : u.endsWith("/api/projects") && r.request().method() === "GET"
              ? [project]
              : project,
        ),
      });
    });
    await page.route("**/api/ai/**", async (r) => {
      const data = r.request().postDataJSON();
      if (r.request().url().endsWith("/inspirations")) {
        ideaCalls++;
        assert.equal(data.prompt, "蝎子精");
        assert.equal(data.brief.genre, "奇幻");
        await r.fulfill({
          status: fail ? 502 : 200,
          contentType: "application/json",
          body: JSON.stringify(
            fail
              ? { error: "灵感服务暂不可用" }
              : {
                  directions: [1, 2, 3].map((i) => ({
                    title: `方向${i}`,
                    summary: `新的冲突${i}`,
                    prompt: `蝎子精在荒寺寻找故人，方向${i}。`,
                  })),
                },
          ),
        });
      } else await r.fulfill({ contentType: "application/json", body: JSON.stringify(outline) });
    });
    await page.goto(base + "/editor/ideas-check#creation");
    const input = page.getByRole("textbox", { name: "故事创意", exact: true });
    await input.waitFor();
    await page.getByRole("combobox", { name: "叙事形式" }).click();
    assert.equal(await page.getByRole("option").count(), 2);
    await page.getByRole("option", { name: "线性短剧", exact: true }).click();
    assert.equal(await page.getByRole("combobox", { name: "决策点数量" }).count(), 0);
    await page.getByRole("combobox", { name: "叙事形式" }).click();
    await page.getByRole("option", { name: "互动剧", exact: true }).click();
    assert.match(await page.getByRole("combobox", { name: "决策点数量" }).innerText(), /自动/);
    await page.getByRole("button", { name: "生成三个方向" }).click();
    await page.getByRole("button", { name: /方向1/ }).click();
    await page.getByLabel("灵感预览").waitFor();
    await page.getByLabel("灵感预览").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "/tmp/newbee-inspirations-preview.png" });
    assert.equal(await input.inputValue(), "蝎子精");
    await page.getByRole("button", { name: "采用此方向" }).click();
    assert.match(await input.inputValue(), /方向1/);
    await page.getByRole("button", { name: "撤销采用" }).click();
    assert.equal(await input.inputValue(), "蝎子精");
    await page.getByRole("button", { name: "生成三个方向" }).click();
    await page.getByRole("button", { name: /方向2/ }).click();
    await page.getByRole("button", { name: "悬疑", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "采用此方向" }).isDisabled(), true);
    await page.getByRole("button", { name: "奇幻", exact: true }).click();
    fail = true;
    await page.getByRole("button", { name: "换一组方向" }).click();
    await page.getByText("灵感服务暂不可用", { exact: true }).waitFor();
    assert.equal(await input.inputValue(), "蝎子精");
    fail = false;
    await page.getByRole("button", { name: "生成故事大纲", exact: true }).click();
    await page.getByText("待应用", { exact: true }).waitFor();
    await input.fill("蝎子精寻找真相");
    assert.equal(
      await page.getByRole("button", { name: "应用到剧情画布，进入分支设计 →" }).isDisabled(),
      true,
    );
    await page.getByRole("button", { name: "恢复结果对应设置" }).click();
    assert.equal(await input.inputValue(), "蝎子精");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.waitForFunction(() => document.body.innerText.includes("已保存"));
    assert.ok(project.creation.pendingStorySource);
    await page.goto("about:blank");
    await page.goto(base + "/editor/ideas-check#creation");
    await page.getByText("待应用", { exact: true }).waitFor();
    await page.getByRole("button", { name: "应用到剧情画布，进入分支设计 →" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "备份并应用" }).click();
    await page.getByRole("heading", { name: "分支剧情", level: 1 }).waitFor();
    await page.getByRole("button", { name: /故事与剧本/ }).click();
    await page.getByText("已应用", { exact: true }).waitFor();
    await input.fill("修改后的故事");
    await page.getByRole("button", { name: /分镜设计/ }).click();
    await page.getByRole("button", { name: "恢复已应用设置" }).click();
    await page.getByRole("heading", { name: "分镜设计", level: 1 }).waitFor();
    await page.getByRole("button", { name: /故事与剧本/ }).click();
    await page.screenshot({ path: "/tmp/newbee-story-ideas.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({ path: "/tmp/newbee-story-ideas-mobile.png" });
    assert.deepEqual(errors, []);
    console.log(
      "PASS: modes, previews, adoption/undo, failure preservation, stale guards, persisted sources, application and downstream protection; " +
        ideaCalls +
        " inspiration requests",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
