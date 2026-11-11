const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load-ts.cjs");
const { generateTextDraft } = load("lib/ai/text-generation.ts");
const { generateOutlineTool } = load("lib/ai/tools/story-tools.ts");
const { createTextProvider } = load("lib/ai/providers/text-provider.ts");
const story = {
  title: "雨夜",
  description: "寻找证据",
  genre: "悬疑",
  visualStyle: "cinematic",
  characters: [{ name: "林", role: "侦探", description: "red coat" }],
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
  duration: 5,
  imagePrompt: "a detective in rain",
}));
const routes = [
  ["script", { prompt: "雨夜的侦探", numBranches: 2 }, story],
  ["branch-agent", { storyOutline: story }, branch],
  ["storyboard-agent", { storyOutline: story, branchDesign: branch }, shots],
  ["scene-prompt", { nodeTitle: "车站", context: "雨夜", style: "写实" }, "林穿过雨幕。"],
];
const names = [
  "TEXT_PROVIDER",
  "TEXT_BASE_URL",
  "TEXT_API_KEY",
  "TEXT_MODEL",
  "MODEL_NAME",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY",
];
async function isolated(fn) {
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]])),
    fetch = global.fetch;
  for (const name of names) delete process.env[name];
  Object.assign(process.env, {
    TEXT_PROVIDER: "openai",
    TEXT_BASE_URL: "https://proxy.test/forward",
    TEXT_API_KEY: "private-key",
    TEXT_MODEL: "stream-model",
  });
  try {
    await fn();
  } finally {
    global.fetch = fetch;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
const event = (value) => "data: " + JSON.stringify(value) + "\n\n";
const delta = (text, finish = null) => ({
  id: "chat",
  object: "chat.completion.chunk",
  created: 1,
  model: "stream-model",
  choices: [{ index: 0, delta: text ? { content: text } : {}, finish_reason: finish }],
});
function sse(value, { finish = true, error = false } = {}) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  let body = event(delta(text.slice(0, 13))) + event(delta(text.slice(13)));
  if (error) body += event({ error: { message: "private-upstream-error" } });
  if (finish)
    body +=
      event(delta("", "stop")) +
      event({ id: "chat", choices: [], usage: { prompt_tokens: 7, completion_tokens: 11 } }) +
      "data: [DONE]\n\n";
  const bytes = new TextEncoder().encode(body);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 11) controller.enqueue(bytes.slice(i, i + 11));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
const call = (name, body, signal) =>
  load(`app/api/ai/${name}/route.ts`).POST(
    new Request(`http://localhost/api/ai/${name}`, {
      method: "POST",
      body: JSON.stringify(body),
      signal,
    }),
  );

test("script, branches, storyboard and scene descriptions request SSE and preserve validated response formats", () =>
  isolated(async () => {
    for (const [name, input, output] of routes) {
      let count = 0;
      global.fetch = async (url, init) => {
        count++;
        assert.equal(String(url), "https://proxy.test/forward/chat/completions");
        const body = JSON.parse(init.body);
        assert.equal(body.stream, true, name);
        assert.equal(body.model, "stream-model");
        assert.equal(new Headers(init.headers).get("authorization"), "Bearer private-key");
        return sse(output);
      };
      const response = await call(name, input);
      assert.equal(response.status, 200, name + ": " + (await response.clone().text()));
      assert.ok(response.headers.get("content-type").startsWith("text/plain"));
      const text = await response.text();
      if (name === "scene-prompt") assert.equal(text, output);
      else {
        const parsed = JSON.parse(text);
        if (name === "script") assert.equal(parsed.title, story.title);
        if (name === "branch-agent") assert.equal(parsed.endings.length, 2);
        if (name === "storyboard-agent") {
          assert.equal(parsed.length, 3);
          assert.ok(parsed.every((shot) => shot.shotId && shot.visualStyle === "cinematic"));
        }
      }
      assert.equal(count, 1);
    }
  }));
test("all creation routes reject complete-looking data from interrupted or failed SSE without a duplicate call", () =>
  isolated(async () => {
    for (const [name, input, output] of routes)
      for (const mode of ["early-eof", "error"]) {
        let count = 0;
        global.fetch = async () => {
          count++;
          return sse(output, { finish: false, error: mode === "error" });
        };
        const response = await call(name, input),
          failure = await response.json();
        assert.equal(response.status, 502, name);
        assert.match(failure.error, /文本流/);
        assert.equal(failure.text, undefined);
        assert.equal(JSON.stringify(failure).includes("private-upstream-error"), false);
        assert.equal(count, 1);
      }
  }));
test("domain validation still rejects nonexistent branches and missing storyboard scenes after a successful SSE", () =>
  isolated(async () => {
    const invalids = [
      [
        "script",
        routes[0][1],
        {
          ...story,
          scenes: [
            { ...story.scenes[0], choices: [{ label: "bad", leadsTo: "missing" }] },
            ...story.scenes.slice(1),
          ],
        },
      ],
      [
        "branch-agent",
        routes[1][1],
        { ...branch, endings: [{ sceneId: "missing", title: "bad", description: "bad" }] },
      ],
      ["storyboard-agent", routes[2][1], shots.slice(1)],
    ];
    for (const [name, input, output] of invalids) {
      global.fetch = async () => sse(output);
      const response = await call(name, input);
      assert.equal(response.status, 502, name);
      assert.ok((await response.json()).error);
    }
  }));
test("nested outline generation uses the injected streaming provider, schema and usage accounting", () =>
  isolated(async () => {
    let count = 0,
      usage = 0;
    global.fetch = async (url, init) => {
      count++;
      const body = JSON.parse(init.body);
      assert.equal(body.stream, true);
      assert.ok(JSON.stringify(body.messages).includes("visualStyle"));
      return sse(story);
    };
    const output = await generateOutlineTool.execute(
      { prompt: "雨夜", genre: "悬疑", numBranches: 2 },
      { textProvider: createTextProvider(), onUsage: (tokens) => (usage += tokens) },
    );
    assert.equal(JSON.parse(output).title, story.title);
    assert.equal(usage, 18);
    assert.equal(count, 1);
    global.fetch = async () => sse({ ...story, characters: [{ name: "林" }] });
    await assert.rejects(() =>
      generateOutlineTool.execute(
        { prompt: "雨夜", genre: "悬疑", numBranches: 2 },
        { textProvider: createTextProvider() },
      ),
    );
  }));
test("Agent HTTP route uses checked SSE and emits no usable story or done on truncated input", () =>
  isolated(async () => {
    let count = 0;
    global.fetch = async (url, init) => {
      count++;
      assert.equal(JSON.parse(init.body).stream, true);
      return sse(story);
    };
    const request = { task: "story", context: { prompt: "雨夜" } };
    let response = await call("agent", request),
      body = await response.text();
    assert.equal(response.status, 200);
    assert.ok(body.includes('"type":"done"'));
    assert.ok(body.includes('"type":"text"'));
    assert.equal(count, 1);
    global.fetch = async () => sse(story, { finish: false });
    response = await call("agent", request);
    body = await response.text();
    assert.ok(body.includes('"type":"error"'));
    assert.equal(body.includes('"type":"done"'), false);
    assert.equal(body.includes('"type":"text"'), false);
  }));
test("streaming transport preserves Anthropic protocol, custom URL and API key headers", () =>
  isolated(async () => {
    process.env.TEXT_PROVIDER = "anthropic";
    process.env.TEXT_BASE_URL = "https://anthropic.test/v1";
    global.fetch = async (url, init) => {
      assert.equal(String(url), "https://anthropic.test/v1/messages");
      assert.equal(new Headers(init.headers).get("x-api-key"), "private-key");
      assert.equal(JSON.parse(init.body).stream, true);
      const events = [
        [
          "message_start",
          {
            type: "message_start",
            message: {
              id: "message",
              type: "message",
              role: "assistant",
              model: "stream-model",
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 7, output_tokens: 0 },
            },
          },
        ],
        [
          "content_block_start",
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        ],
        [
          "content_block_delta",
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "雨夜的车站。" },
          },
        ],
        ["content_block_stop", { type: "content_block_stop", index: 0 }],
        [
          "message_delta",
          {
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: 11 },
          },
        ],
        ["message_stop", { type: "message_stop" }],
      ];
      return new Response(
        events.map(([name, value]) => `event: ${name}\n${event(value)}`).join(""),
        { headers: { "content-type": "text/event-stream" } },
      );
    };
    const output = await generateTextDraft({
      provider: createTextProvider(),
      prompt: "写一个场景",
    });
    assert.equal(output.text, "雨夜的车站。");
    assert.equal(output.usage.promptTokens, 7);
    assert.equal(output.usage.completionTokens, 11);
  }));
test("pre-aborted generation never calls the provider for any text route", () =>
  isolated(async () => {
    let count = 0;
    global.fetch = async () => {
      count++;
      throw Error("must not submit");
    };
    const controller = new AbortController();
    controller.abort();
    for (const [name, input] of routes) {
      const response = await call(name, input, controller.signal);
      assert.equal(response.status, 502, name);
    }
    assert.equal(count, 0);
  }));

test("idea expansion sends the original idea and selected brief to the model and returns editable text", () =>
  isolated(async () => {
    const expanded = "蝎子精隐居荒寺，为救中毒的村民踏入天界禁地，却发现毒源与自己的身世有关。";
    let calls = 0;
    global.fetch = async (url, init) => {
      calls++;
      const body = JSON.parse(init.body),
        messages = JSON.stringify(body.messages);
      assert.equal(body.stream, true);
      assert.equal(body.max_tokens, 2500);
      assert.ok(messages.includes("蝎子精"));
      assert.ok(messages.includes("奇幻"));
      assert.ok(messages.includes("第一人称"));
      return sse(expanded);
    };
    const response = await call("expand-idea", {
      prompt: "蝎子精",
      brief: { genre: "奇幻", narrativeStyle: "第一人称" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { prompt: expanded });
    assert.equal(calls, 1);
  }));
test("idea expansion rejects empty input, incomplete streams and oversized output without returning replacement text", () =>
  isolated(async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return sse("新创意");
    };
    for (const prompt of ["   ", "字".repeat(2001)]) {
      const response = await call("expand-idea", { prompt, brief: {} });
      assert.equal(response.status, 400);
    }
    assert.equal(calls, 0);
    for (const output of [() => sse("不完整", { finish: false }), () => sse("字".repeat(2001))]) {
      global.fetch = async () => output();
      const response = await call("expand-idea", { prompt: "蝎子精", brief: {} });
      assert.equal(response.status, 502);
      const body = await response.json();
      assert.ok(body.error);
      assert.equal(body.prompt, undefined);
    }
  }));

test("inspiration generation uses original idea and genre, validates three distinct previews and rejects invalid output", () =>
  isolated(async () => {
    const directions = [1, 2, 3].map((i) => ({
      title: `方向${i}`,
      summary: `冲突${i}`,
      prompt: `蝎子精的发展方向${i}`,
    }));
    let count = 0;
    global.fetch = async (url, init) => {
      count++;
      const body = JSON.parse(init.body),
        messages = JSON.stringify(body.messages);
      assert.ok(messages.includes("蝎子精"));
      assert.ok(messages.includes("奇幻"));
      assert.ok(messages.includes("三个"));
      return sse({ directions });
    };
    let response = await call("inspirations", { prompt: "蝎子精", brief: { genre: "奇幻" } });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).directions, directions);
    assert.equal(count, 1);
    response = await call("inspirations", { prompt: " ", brief: {} });
    assert.equal(response.status, 400);
    assert.equal(count, 1);
    for (const invalid of [
      { directions: directions.slice(0, 2) },
      { directions: [directions[0], directions[0], directions[2]] },
      { directions: directions.map((d) => ({ ...d, prompt: "字".repeat(2001) })) },
    ]) {
      global.fetch = async () => sse(invalid);
      response = await call("inspirations", { prompt: "蝎子精", brief: {} });
      assert.equal(response.status, 502);
      assert.equal((await response.json()).directions, undefined);
    }
  }));

test("outline event transport sends provisional deltas and a validated final result", () =>
  isolated(async () => {
    global.fetch = async () => sse(story);
    const { POST } = load("app/api/ai/script/route.ts");
    const { readCreationJSON } = load("lib/ai/creation-response.ts");
    let preview = "";
    let response = await POST(
      new Request("http://localhost/api/ai/script", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({ prompt: "雨夜" }),
      }),
    );
    assert.ok(response.headers.get("content-type").includes("application/x-ndjson"));
    assert.equal(
      (await readCreationJSON(response, (chunk) => (preview += chunk))).title,
      story.title,
    );
    assert.equal(JSON.parse(preview).title, story.title);
    global.fetch = async () => sse(story, { finish: false });
    response = await POST(
      new Request("http://localhost/api/ai/script", {
        method: "POST",
        headers: { Accept: "application/x-ndjson" },
        body: JSON.stringify({ prompt: "雨夜" }),
      }),
    );
    await assert.rejects(() => readCreationJSON(response), /文本流/);
  }));
test("text generation keeps explicit time budgets and diagnoses timeout without an automatic retry", () =>
  isolated(async () => {
    let calls = 0;
    global.fetch = async (url, init) =>
      new Promise((resolve, reject) => {
        calls++;
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
    const { textGenerationError } = load("lib/ai/text-error.ts");
    const keepAlive = setTimeout(() => {}, 1000);
    try {
      await assert.rejects(
        () => generateTextDraft({ provider: createTextProvider(), prompt: "test", timeoutMs: 20 }),
        (error) => {
          assert.equal(textGenerationError(error).code, "TEXT_GENERATION_TIMEOUT");
          return true;
        },
      );
      assert.equal(calls, 1);
    } finally {
      clearTimeout(keepAlive);
    }
  }));

test("branch and storyboard share progress transport, validation and task budgets", () =>
  isolated(async () => {
    const { readCreationJSON } = load("lib/ai/creation-response.ts");
    const { creationPolicy } = load("lib/ai/creation-policy.ts");
    for (const [name, input, output] of routes.filter(([name]) =>
      ["branch-agent", "storyboard-agent"].includes(name),
    )) {
      let calls = 0;
      global.fetch = async (url, init) => {
        calls++;
        const request = JSON.parse(init.body);
        assert.equal(request.stream, true);
        assert.equal(
          request.max_tokens,
          creationPolicy[name === "branch-agent" ? "branch" : "storyboard"].maxTokens,
        );
        return sse(output);
      };
      const { POST } = load(`app/api/ai/${name}/route.ts`);
      const invoke = () =>
        POST(
          new Request(`http://localhost/api/ai/${name}`, {
            method: "POST",
            headers: { Accept: "application/x-ndjson" },
            body: JSON.stringify(input),
          }),
        );
      let response = await invoke();
      assert.match(response.headers.get("content-type"), /application\/x-ndjson/);
      let preview = "";
      const result = await readCreationJSON(response, (text) => (preview += text));
      assert.ok(preview.length > 0);
      if (name === "storyboard-agent") {
        assert.equal(result.length, 3);
        assert.ok(
          result.every(
            (shot) =>
              shot.visualStyle === story.visualStyle &&
              shot.characterDescriptions[0].includes("red coat"),
          ),
        );
      } else assert.equal(result.endings.length, 2);
      assert.equal(calls, 1);
      global.fetch = async () => sse(output, { finish: false });
      response = await invoke();
      await assert.rejects(() => readCreationJSON(response), /文本流/);
      global.fetch = async () =>
        sse(name === "branch-agent" ? { decisionPoints: [], endings: [] } : []);
      response = await invoke();
      await assert.rejects(() => readCreationJSON(response));
    }
    assert.ok(creationPolicy.storyboard.timeoutMs > 120000);
    assert.ok(creationPolicy.branch.timeoutMs > 120000);
  }));
