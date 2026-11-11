const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load-ts.cjs");
const { z } = require("zod");
const { AgentHarness, agentEventsToSSE } = load("lib/ai/agent-loop.ts");
const { ToolRegistry } = load("lib/ai/tools/registry.ts");
const { PromptBuilder } = load("lib/ai/context/prompt-builder.ts");
const { LoopDetector } = load("lib/ai/loop-detection.ts");
const defense = load("lib/ai/context/defense.ts");
const validation = load("lib/ai/output-validation.ts");
const { createDefaultPromptBuilder, PROMPT_VERSION } = load("lib/ai/context/prompt-pipes.ts");
const { generateCreation } = load("lib/ai/creation-generation.ts");
const { shotPrompt, shotVoice } = load("lib/production/shots.ts");
// Fail closed for every test: models are in-process doubles; provider HTTP is locally stubbed.
const originalFetch = global.fetch;
global.fetch = async () => {
  throw new Error("NETWORK FORBIDDEN: paid calls disabled in regression tests");
};
after(() => {
  global.fetch = originalFetch;
});
const story = {
  visualStyle: "cinematic",
  title: "雨夜",
  description: "寻找证据",
  genre: "悬疑",
  characters: [{ name: "林", role: "侦探", description: "red coat, short black hair, calm voice" }],
  scenes: [
    {
      id: "a",
      title: "车站",
      description: "相遇",
      scenePrompt: "rainy station",
      order: 0,
      choices: [
        { label: "追踪", leadsTo: "b" },
        { label: "离开", leadsTo: "c" },
      ],
    },
    {
      id: "b",
      title: "真相",
      description: "找到证据",
      scenePrompt: "evidence",
      order: 1,
      choices: [],
    },
    {
      id: "c",
      title: "错过",
      description: "失去线索",
      scenePrompt: "empty street",
      order: 2,
      choices: [],
    },
  ],
};
const branch = {
  decisionPoints: [
    {
      sceneId: "a",
      question: "怎么办",
      choices: [
        { label: "追踪", targetSceneId: "b", consequence: "找到证据" },
        { label: "离开", targetSceneId: "c", consequence: "失去线索" },
      ],
    },
  ],
  endings: [
    { sceneId: "b", title: "真相", description: "找到证据" },
    { sceneId: "c", title: "错过", description: "失去线索" },
  ],
};
const shots = story.scenes.map((scene) => ({
  sceneId: scene.id,
  shotIndex: 0,
  characterNames: [],
  frameType: "中景",
  cameraMove: "固定",
  lighting: "cold",
  action: "林回头",
  dialogue: "跟我走",
  speaker: "林",
  duration: 5,
  imagePrompt: "a detective in rain",
}));
function provider(steps, onOptions = () => {}) {
  let calls = 0;
  const model = {
    specificationVersion: "v1",
    provider: "offline",
    modelId: "offline",
    defaultObjectGenerationMode: "json",
    async doStream(options) {
      onOptions(options);
      const value = steps[Math.min(calls++, steps.length - 1)];
      if (value instanceof Error) throw value;
      const current =
        typeof value === "string" ? [{ type: "text-delta", textDelta: value }] : value;
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of current) controller.enqueue(part);
            controller.enqueue({
              type: "finish",
              finishReason: current.some((p) => p.type === "tool-call") ? "tool-calls" : "stop",
              usage: { promptTokens: 11, completionTokens: 7 },
            });
            controller.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
    async doGenerate() {
      throw new Error("Non-streaming model calls are forbidden");
    },
  };

  return {
    id: "offline",
    name: "offline",
    model,
    contextWindow: 128000,
    get calls() {
      return calls;
    },
  };
}
const text = (value) => [
  { type: "text-delta", textDelta: typeof value === "string" ? value : JSON.stringify(value) },
];
const call = (id, name, args) => ({
  type: "tool-call",
  toolCallType: "function",
  toolCallId: id,
  toolName: name,
  args: JSON.stringify(args),
});
async function run(p, registry = new ToolRegistry(), task = "story", extra = {}) {
  const harness = new AgentHarness(p, registry, new PromptBuilder());
  return Array.fromAsync(
    harness.run({ task, messages: [{ role: "user", content: "test" }], ...extra }),
  );
}

test("context counts multilingual text, tool args and result payload; compaction preserves SDK tool IDs", async () => {
  const messages = [];
  for (let i = 0; i < 4; i++) {
    messages.push({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: String(i),
          toolName: "lookup",
          args: { query: "中文".repeat(100) },
        },
      ],
    });
    messages.push({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: String(i),
          toolName: "lookup",
          result: { body: "中文".repeat(10000) },
        },
      ],
    });
  }
  assert.ok(defense.estimateTokens(messages) > 40000);
  const defended = defense.applyContextDefense(messages, 20000);
  const cleared = defended.messages[1].content[0];
  assert.equal(cleared.toolCallId, "0");
  assert.equal(cleared.type, "tool-result");
  assert.equal(cleared.result.compacted, true);
  assert.equal(messages[1].content[0].result.body.length, 20000);
  let called = false;
  const p = provider([text(story)], () => (called = true));
  const events = await run(p, new ToolRegistry(), "story", { messages: defended.messages });
  assert.equal(called, true);
  assert.equal(events.at(-1).type, "done");
  assert.throws(
    () => defense.applyContextDefense([{ role: "user", content: "x".repeat(1000) }], 100),
    /预算/,
  );
  assert.throws(
    () => defense.applyContextDefense([{ role: "user", content: "small" }], 100, 100),
    /预算/,
  );
});
test("structured outline tool results larger than 6000 characters remain valid complete JSON", async () => {
  const definition = load("lib/ai/tools/story-tools.ts").generateOutlineTool;
  const large = { ...story, description: "长故事".repeat(4000) };
  const registry = new ToolRegistry().register({ ...definition, execute: async () => large });
  const result = await registry
    .toAISDKFormat()
    .generate_outline.execute({}, { toolCallId: "x", messages: [] });
  assert.deepEqual(JSON.parse(result), large);
});
test("loop histories are isolated and registry blocks critical repetition before execution", async () => {
  const a = new LoopDetector(),
    b = new LoopDetector();
  for (let i = 0; i < 7; i++) a.recordCall("x", {});
  assert.equal(a.detect("x", {}).stuck, true);
  b.resetHistory();
  assert.equal(a.detect("x", {}).stuck, true);
  assert.equal(b.detect("x", {}).stuck, false);
  let executed = 0;
  const registry = new ToolRegistry().register({
    name: "x",
    description: "x",
    schema: z.object({}),
    execute: async () => {
      executed++;
      return "same";
    },
  });
  await assert.rejects(
    () =>
      registry
        .toAISDKFormat((name, input) => {
          const result = a.detect(name, input);
          if (result.stuck && result.level === "critical") throw new Error("blocked");
        })
        .x.execute({}, { toolCallId: "x", messages: [] }),
    /blocked/,
  );
  assert.equal(executed, 0);
});
test("parallel tool calls keep distinct results and tokens accumulate across steps", async () => {
  const registry = new ToolRegistry().register({
    name: "lookup",
    description: "lookup",
    schema: z.object({ id: z.string() }),
    execute: async ({ id }) => {
      if (id === "slow") await new Promise((resolve) => setTimeout(resolve, 15));
      return id;
    },
  });
  const p = provider([
    [call("1", "lookup", { id: "slow" }), call("2", "lookup", { id: "fast" })],
    text(story),
  ]);
  const events = await run(p, registry);
  assert.equal(events.at(-1).type, "done");
  assert.equal(events.at(-1).tokens, 36);
  assert.deepEqual(
    events
      .filter((e) => e.type === "tool_result")
      .map((e) => e.preview)
      .sort(),
    ["fast", "slow"],
  );
  assert.equal(events.filter((e) => e.type === "text").length, 1);
});
test("SDK stream error yields error, no success; a charged tool is never replayed on retryable failure", async () => {
  let executions = 0;
  const registry = new ToolRegistry().register({
    name: "paid",
    description: "paid",
    schema: z.object({}),
    execute: async () => {
      executions++;
      throw new Error("503 provider unavailable");
    },
  });
  const p = provider([[call("1", "paid", {})]]);
  const events = await run(p, registry);
  assert.equal(executions, 1);
  assert.equal(p.calls, 1);
  assert.equal(events.at(-1).type, "error");
  assert.equal(
    events.some((e) => e.type === "done"),
    false,
  );
  const streamErrors = await run(
    provider([[{ type: "error", error: new Error("bad model output") }]]),
  );
  assert.equal(streamErrors.at(-1).type, "error");
});
test("invalid final story never emits usable text or done", async () => {
  for (const invalid of [
    "partial {",
    JSON.stringify({
      ...story,
      scenes: [{ ...story.scenes[0], choices: [{ label: "bad", leadsTo: "missing" }] }],
    }),
  ]) {
    const events = await run(provider([text(invalid)]));
    assert.equal(events.at(-1).type, "error");
    assert.equal(
      events.some((e) => e.type === "text" || e.type === "done"),
      false,
    );
  }
});
test("aborted requests avoid model execution and SSE cancellation aborts producer", async () => {
  const abort = new AbortController();
  abort.abort();
  const p = provider([text(story)]);
  const events = await run(p, new ToolRegistry(), "story", { signal: abort.signal });
  assert.equal(p.calls, 0);
  assert.equal(events.at(-1).type, "error");
  const controller = new AbortController();
  let finalized = false;
  async function* source() {
    try {
      yield { type: "text", content: "x" };
      yield { type: "done", steps: 1, tokens: 1, provider: "offline" };
    } finally {
      finalized = true;
    }
  }
  const reader = agentEventsToSSE(source(), controller).getReader();
  await reader.read();
  await reader.cancel();
  assert.equal(controller.signal.aborted, true);
  assert.equal(finalized, true);
});
test("visual results come from executed provider tools; invented URLs and placeholders never complete", async () => {
  const noTool = await run(
    provider([text('[{"imageUrl":"https://invented.test/x.png","status":"done"}]')]),
    new ToolRegistry(),
    "visual",
  );
  assert.equal(noTool.at(-1).type, "error");
  const registry = new ToolRegistry().register({
    name: "generate_image",
    description: "image",
    schema: z.object({}),
    preserveResult: true,
    execute: async () =>
      JSON.stringify({ sceneId: "a", imageUrl: "https://real.test/a.png", status: "done" }),
  });
  const events = await run(
    provider([[call("1", "generate_image", {})], text("invented URL")]),
    registry,
    "visual",
    { projectContext: { scenes: [{ id: "a" }] } },
  );
  assert.equal(events.at(-1).type, "done");
  assert.equal(
    JSON.parse(events.find((e) => e.type === "text").content)[0].imageUrl,
    "https://real.test/a.png",
  );
  registry.register({
    name: "generate_image",
    description: "image",
    schema: z.object({}),
    execute: async () => JSON.stringify({ status: "placeholder" }),
  });
  const failed = await run(provider([[call("1", "generate_image", {})]]), registry, "visual");
  assert.equal(failed.at(-1).type, "error");
});
test("shared versioned prompt includes roles, branch consequences and visual style, only active tool names", () => {
  const prompt = createDefaultPromptBuilder().build({
    task: "storyboard",
    profile: "storyboard",
    toolCount: 1,
    toolNames: ["generate_image"],
    deferredSummary: "",
    projectContext: { ...story, branchDesign: branch, visualStyle: "watercolor" },
  });
  for (const value of [
    PROMPT_VERSION,
    "red coat",
    "找到证据",
    "watercolor",
    "speaker",
    "characterDescriptions",
    "generate_image",
  ])
    assert.ok(prompt.includes(value), value);
  assert.equal(prompt.includes("submit_video_job +"), false);
  assert.equal(prompt.includes("使用占位结果继续"), false);
});
test("creation pipeline passes full context, validates output and persists role/style constraints into production prompts", async () => {
  let prompt;
  const result = await generateCreation(
    "storyboard",
    { storyOutline: story, branchDesign: branch, visualStyle: "watercolor" },
    provider([JSON.stringify(shots)], (options) => (prompt = JSON.stringify(options.prompt))),
  );
  assert.ok(prompt.includes("red coat"));
  assert.ok(prompt.includes("失去线索"));
  assert.ok(prompt.includes("watercolor"));
  assert.ok(shotPrompt(result[0]).includes("red coat"));
  assert.ok(shotPrompt(result[0]).includes("watercolor"));
  assert.equal(result[0].speaker, "林");
  assert.equal(shotVoice(result[0]), shotVoice(result[1]));
  assert.equal(shotVoice({ ...result[0], voice: "echo" }), "echo");
  assert.equal(
    (await generateCreation("branch", { storyOutline: story }, provider([JSON.stringify(branch)])))
      .endings.length,
    2,
  );
  await assert.rejects(
    () => generateCreation("storyboard", { storyOutline: story }, provider(["[]"])),
    /镜头/,
  );
});
test("semantic validation rejects unknown references, duplicate decisions, missing scene shots and unknown speakers", () => {
  assert.throws(() =>
    validation.validateBranches(
      { ...branch, endings: [{ sceneId: "missing", title: "x", description: "x" }] },
      story.scenes,
    ),
  );
  assert.throws(() =>
    validation.validateBranches(
      { ...branch, decisionPoints: [branch.decisionPoints[0], branch.decisionPoints[0]] },
      story.scenes,
    ),
  );
  assert.throws(() =>
    validation.validateStoryboard(shots.slice(1), story.scenes, story.characters),
  );
  assert.throws(() =>
    validation.validateStoryboard(
      [{ ...shots[0], speaker: "unknown" }, ...shots.slice(1)],
      story.scenes,
      story.characters,
    ),
  );
  assert.throws(() =>
    validation.validateStoryboard(
      [{ ...shots[0], speaker: undefined }, ...shots.slice(1)],
      story.scenes,
      story.characters,
    ),
  );
  assert.throws(
    () =>
      validation.validateStory({
        ...story,
        scenes: [
          story.scenes[0],
          { ...story.scenes[1], choices: [{ label: "cycle", leadsTo: "b" }] },
          story.scenes[2],
        ],
      }),
    /结局/,
  );
});

test("Seedance synchronous result URL survives submit/poll; async image-to-video uses the same endpoint", async () => {
  const { createVideoProvider } = load("lib/ai/providers/video-provider.ts");
  const names = ["FAL_API_KEY", "KLING_API_KEY", "RUNWAY_API_KEY", "STORYREEL_GENERATION_MODE"];
  const env = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const blockedFetch = global.fetch;
  try {
    names.forEach((name) => delete process.env[name]);
    assert.throws(() => createVideoProvider(), /配置/);
    process.env.FAL_API_KEY = "offline-key";
    global.fetch = async () => Response.json({ video: { url: "https://example.test/real.mp4" } });
    let p = createVideoProvider();
    let job = await p.submit({ prompt: "offline" });
    assert.equal((await p.poll(job)).videoUrl, "https://example.test/real.mp4");
    const urls = [];
    let index = 0;
    global.fetch = async (url) => {
      urls.push(url);
      return Response.json(
        [
          { request_id: "job-1" },
          { status: "COMPLETED" },
          { video: { url: "https://example.test/async.mp4" } },
        ][index++],
      );
    };
    job = await p.submit({
      prompt: "offline",
      mode: "image-to-video",
      firstFrameUrl: "https://example.test/frame.png",
    });
    const result = await p.poll(job);
    assert.equal(result.videoUrl, "https://example.test/async.mp4");
    assert.ok(urls.every((url) => url.includes("/image-to-video")));
    global.fetch = async () => new Response("failure", { status: 503 });
    await assert.rejects(() => p.poll(job), /503/);
    delete process.env.FAL_API_KEY;
    process.env.STORYREEL_GENERATION_MODE = "mock";
    assert.equal(createVideoProvider().id, "mock");
  } finally {
    global.fetch = blockedFetch;
    for (const name of names) {
      if (env[name] === undefined) delete process.env[name];
      else process.env[name] = env[name];
    }
  }
});
test("video tool missing provider, submit failure and completion without URL are visible failures", async () => {
  const { submitVideoJobTool, pollVideoJobTool } = load("lib/ai/tools/media-tools.ts");
  await assert.rejects(
    () => submitVideoJobTool.execute({ sceneId: "a", prompt: "offline" }),
    /配置/,
  );
  await assert.rejects(
    () =>
      submitVideoJobTool.execute(
        { sceneId: "a", prompt: "offline" },
        {
          videoProvider: {
            submit: async () => {
              throw new Error("503");
            },
          },
        },
      ),
    /503/,
  );
  await assert.rejects(
    () =>
      pollVideoJobTool.execute(
        { sceneId: "a", jobId: "x", provider: "seedance" },
        { videoProvider: { poll: async () => ({ status: "done" }) } },
      ),
    /地址/,
  );
});
test("story tool uses injected text provider/context/signal; no implicit secondary model", async () => {
  const { generateOutlineTool } = load("lib/ai/tools/story-tools.ts");
  const abort = new AbortController();
  let captured;
  const p = provider(
    [JSON.stringify(story)],
    (options) => (captured = JSON.stringify(options.prompt)),
  );
  const result = await generateOutlineTool.execute(
    { prompt: "线索", genre: "悬疑", numBranches: 2 },
    {
      textProvider: p,
      projectContext: { visualStyle: "watercolor", characters: story.characters },
      signal: abort.signal,
    },
  );
  assert.equal(p.calls, 1);
  assert.ok(captured.includes("watercolor"));
  assert.ok(captured.includes("red coat"));
  assert.equal(JSON.parse(result).genre, "悬疑");
  await assert.rejects(() => generateOutlineTool.execute({ prompt: "x" }), /未注入/);
});
test("branch semantic validator rejects disconnected endings and routes that never terminate", () => {
  assert.throws(() =>
    validation.validateBranches(
      {
        ...branch,
        decisionPoints: [
          {
            ...branch.decisionPoints[0],
            choices: [
              { label: "x", targetSceneId: "b", consequence: "" },
              { label: "y", targetSceneId: "a", consequence: "" },
            ],
          },
        ],
      },
      story.scenes,
    ),
  );
  const scenes = [...story.scenes, { id: "d", order: 3 }];
  assert.throws(() => validation.validateBranches(branch, scenes), /最后|无法到达/);
});

test("legacy shot revisions stay compatible; changing role/style/voice invalidates generated versions", () => {
  const { shotRevision } = load("lib/production/shots.ts");
  const shot = { ...shots[0], shotId: "shot-a" };
  delete shot.speaker;
  const legacy = JSON.stringify([
    shot.shotId,
    shot.sceneId,
    shot.imagePrompt,
    shot.action,
    shot.cameraMove,
    shot.lighting,
    shot.duration,
    shot.dialogue,
    shot.frameType,
  ]);
  assert.equal(shotRevision(shot), legacy);
  for (const change of [
    { visualStyle: "watercolor" },
    { speaker: "林" },
    { voice: "echo" },
    { characterDescriptions: ["red coat"] },
  ])
    assert.notEqual(shotRevision({ ...shot, ...change }), legacy);
});
test("creation rejects oversized context before contacting even the offline model", async () => {
  const p = provider([JSON.stringify(shots)]);
  p.contextWindow = 50;
  await assert.rejects(() => generateCreation("storyboard", { storyOutline: story }, p), /预算/);
  assert.equal(p.calls, 0);
});

test("creation routes return validated JSON, invalid AI output returns 502, missing context returns 400", async () => {
  const providerModule = load("lib/ai/providers/text-provider.ts");
  const original = providerModule.createTextProvider;
  const request = (body) =>
    new Request("http://localhost/api/ai/storyboard-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const storyboardRoute = load("app/api/ai/storyboard-agent/route.ts");
    const branchRoute = load("app/api/ai/branch-agent/route.ts");
    providerModule.createTextProvider = () => provider([JSON.stringify(shots)]);
    let response = await storyboardRoute.POST(
      request({ storyOutline: story, branchDesign: branch }),
    );
    assert.equal(response.status, 200);
    const result = JSON.parse(await response.text());
    assert.equal(result[0].speaker, "林");
    assert.ok(result[0].characterDescriptions[0].includes("red coat"));
    providerModule.createTextProvider = () => provider(["incomplete JSON"]);
    response = await storyboardRoute.POST(request({ storyOutline: story }));
    assert.equal(response.status, 502);
    assert.ok((await response.json()).error);
    providerModule.createTextProvider = () => provider([JSON.stringify(branch)]);
    response = await branchRoute.POST(request({ storyOutline: story }));
    assert.equal(response.status, 200);
    response = await storyboardRoute.POST(request({ scenes: story.scenes }));
    assert.equal(response.status, 400);
  } finally {
    providerModule.createTextProvider = original;
  }
});
test("completed image generation finishes without a paid model rewrite; nested tool usage is included in totals", async () => {
  const registry = new ToolRegistry().register({
    name: "generate_image",
    description: "image",
    schema: z.object({}),
    preserveResult: true,
    execute: async (_, deps) => {
      deps.onUsage(23);
      return { sceneId: "a", imageUrl: "https://example.test/a.png", status: "done" };
    },
  });
  const p = provider([[call("1", "generate_image", {})]]);
  const events = await run(p, registry, "visual", { projectContext: { scenes: [{ id: "a" }] } });
  assert.equal(p.calls, 1);
  assert.equal(events.at(-1).type, "done");
  assert.equal(events.at(-1).tokens, 41);
});

test("video poll cannot turn a model-invented direct URL into a successful provider result", async () => {
  const { createVideoProvider } = load("lib/ai/providers/video-provider.ts");
  const previous = process.env.FAL_API_KEY;
  const blockedFetch = global.fetch;
  try {
    process.env.FAL_API_KEY = "offline-key";
    const p = createVideoProvider();
    await assert.rejects(
      () =>
        p.poll({
          jobId: "sync_invented",
          provider: "seedance",
          status: "submitted",
          videoUrl: "https://invented.test/result.mp4",
        }),
      /未知/,
    );
    global.fetch = async () => Response.json({ video: { url: "https://example.test/real.mp4" } });
    const job = await p.submit({ prompt: "offline" });
    const result = await p.poll({ ...job, videoUrl: "https://invented.test/result.mp4" });
    assert.equal(result.videoUrl, "https://example.test/real.mp4");
  } finally {
    global.fetch = blockedFetch;
    if (previous === undefined) delete process.env.FAL_API_KEY;
    else process.env.FAL_API_KEY = previous;
  }
});

test("story visual style and original creative brief survive subsequent storyboard generation and schema persistence", async () => {
  const { storyOutlineSchema } = load("lib/story/creation-schema.ts");
  const outline = storyOutlineSchema.parse({ ...story, visualStyle: "ink wash, muted palette" });
  let prompt;
  const output = await generateCreation(
    "storyboard",
    { storyOutline: outline, creativeBrief: "角色不能离开车站" },
    provider([JSON.stringify(shots)], (options) => (prompt = JSON.stringify(options.prompt))),
  );
  assert.ok(prompt.includes("角色不能离开车站"));
  assert.ok(prompt.includes("ink wash"));
  assert.equal(output[0].visualStyle, "ink wash, muted palette");
});

test("Agent never resubmits after partial model text even when the stream error is retryable", async () => {
  const p = provider([
    [
      { type: "text-delta", textDelta: "partial draft" },
      { type: "error", error: new Error("503 provider unavailable") },
    ],
  ]);
  const events = await run(p);
  assert.equal(p.calls, 1);
  assert.equal(events.at(-1).type, "error");
  assert.equal(
    events.some((event) => ["text", "done"].includes(event.type)),
    false,
  );
});
test("project continuity is projected before validating generated storyboard fields", async () => {
  const wrongDerivedFields = shots.map((shot) => ({
    ...shot,
    visualStyle: { wrong: "model-owned" },
    characterDescriptions: "model returned one string",
  }));
  const result = await generateCreation(
    "storyboard",
    { storyOutline: story, visualStyle: "watercolor" },
    provider([JSON.stringify(wrongDerivedFields)]),
  );
  assert.ok(
    result.every(
      (shot) =>
        shot.visualStyle === "watercolor" &&
        Array.isArray(shot.characterDescriptions) &&
        shot.characterDescriptions[0].includes("red coat"),
    ),
  );
  await assert.rejects(() =>
    generateCreation(
      "storyboard",
      { storyOutline: story },
      provider([
        JSON.stringify(wrongDerivedFields.map((shot) => ({ ...shot, frameType: "invalid" }))),
      ]),
    ),
  );
  await assert.rejects(
    () =>
      generateCreation(
        "storyboard",
        { storyOutline: story },
        provider([
          JSON.stringify(
            wrongDerivedFields.map((shot, index) =>
              index === 0 ? { ...shot, sceneId: "missing" } : shot,
            ),
          ),
        ]),
      ),
    /不存在/,
  );
});

test("deferred tool search is profile scoped and refreshes the next model step tools and prompt", async () => {
  let executions = 0;
  const registry = new ToolRegistry()
    .register(
      {
        name: "story_lookup",
        description: "查找故事资料",
        searchHint: "资料",
        profiles: ["story"],
        shouldDefer: true,
        schema: z.object({}),
        execute: async () => {
          executions++;
          return "资料";
        },
      },
      {
        name: "video_lookup",
        description: "查找视频资料",
        profiles: ["video"],
        shouldDefer: true,
        schema: z.object({}),
        execute: async () => {
          throw Error("wrong profile");
        },
      },
    )
    .setProfile("story");
  assert.deepEqual(
    registry.getActiveTools().map((t) => t.name),
    ["tool_search"],
  );
  assert.equal(registry.getDeferredSummary().includes("video_lookup"), false);
  assert.deepEqual(registry.searchTools("video_lookup"), []);
  assert.deepEqual(registry.searchTools("  "), []);
  const prompts = [],
    toolLists = [];
  const p = provider(
    [
      [call("search", "tool_search", { query: "story_lookup" })],
      [call("lookup", "story_lookup", {})],
      text(story),
    ],
    (options) => {
      prompts.push(JSON.stringify(options.prompt));
      toolLists.push((options.mode.tools ?? []).map((t) => t.name));
    },
  );
  const harness = new AgentHarness(p, registry, createDefaultPromptBuilder());
  const events = await Array.fromAsync(
    harness.run({ task: "story", messages: [{ role: "user", content: "查询资料后写故事" }] }),
  );
  assert.equal(events.at(-1).type, "done");
  assert.equal(executions, 1);
  assert.equal(toolLists[0].includes("story_lookup"), false);
  assert.equal(toolLists[1].includes("story_lookup"), true);
  assert.ok(prompts[0].includes("需先调用 tool_search"));
  assert.equal(prompts[1].includes("需先调用 tool_search"), false);
  assert.ok(toolLists.every((names) => !names.includes("video_lookup")));
});
test("transport sends compacted messages and budgets actual tool schemas plus output before model invocation", async () => {
  const { generateTextDraft, streamTextGeneration } = load("lib/ai/text-generation.ts");
  const messages = [];
  for (let i = 0; i < 4; i++) {
    messages.push({
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: String(i), toolName: "lookup", args: {} }],
    });
    messages.push({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: String(i),
          toolName: "lookup",
          result: "OLD_PAYLOAD_" + "x".repeat(2000),
        },
      ],
    });
  }
  let captured;
  const p = provider(["完成"], (options) => (captured = JSON.stringify(options.prompt)));
  await generateTextDraft({ provider: p, messages });
  assert.ok(captured.includes("compacted"));
  assert.equal((captured.match(/OLD_PAYLOAD_/g) ?? []).length, 3);
  assert.ok(messages[1].content[0].result.startsWith("OLD_PAYLOAD_"));
  const registry = new ToolRegistry().register({
    name: "huge",
    description: "x".repeat(20000),
    schema: z.object({}),
    execute: async () => "",
  });
  const small = provider(["unused"]);
  small.contextWindow = 10000;
  assert.throws(
    () =>
      streamTextGeneration({ provider: small, prompt: "small", tools: registry.toAISDKFormat() }),
    /预算/,
  );
  assert.equal(small.calls, 0);
  const once = defense.applyContextDefense(messages);
  const twice = defense.applyContextDefense(once.messages);
  assert.equal(twice.cleared, 0);
});
test("prompt sections share composition, expansion output is prose and direct story does not request unavailable tools", () => {
  const builder = createDefaultPromptBuilder();
  const ctx = {
    task: "expand-idea",
    profile: "expand-idea",
    toolCount: 0,
    deferredSummary: "",
    projectContext: { prompt: "蝎子精" },
  };
  const sections = builder.sections(ctx);
  assert.equal(builder.build(ctx), sections.map((s) => s.content).join("\n\n"));
  assert.deepEqual(
    sections.map((s) => s.name),
    ["coreRules", "contentPolicy", "projectContext", "taskInstructions"],
  );
  assert.ok(builder.build(ctx).includes("蝎子精"));
  assert.ok(builder.build(ctx).includes("中文故事创意正文"));
  const direct = builder.build({ ...ctx, task: "story" });
  assert.equal(direct.includes("调用 validate_story"), false);
  assert.equal(direct.includes("调用 generate_outline"), false);
});
