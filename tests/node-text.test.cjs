const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load-ts.cjs");
const { nodeTextRequest, nodeTextMessages } = load("lib/ai/node-text.ts");
const input = {
  title: "打开信件",
  content: "旧内容",
  role: "scene",
  instruction: "扩写至150字",
  context: "世界设定",
};
test("text generation validates requirements and bounds context before a model call", () => {
  assert.equal(nodeTextRequest.safeParse({ ...input, instruction: "  " }).success, false);
  assert.equal(nodeTextRequest.safeParse({ ...input, role: "unknown" }).success, false);
  assert.equal(nodeTextRequest.safeParse({ ...input, context: "a".repeat(50001) }).success, false);
  assert.equal(nodeTextRequest.safeParse(input).success, true);
});
test("each text role has distinct guidance and retains supplied creative context", () => {
  const systems = new Set();
  for (const role of ["scene", "dialogue", "direction", "prompt"]) {
    const messages = nodeTextMessages({ ...input, role });
    systems.add(messages.system);
    const payload = JSON.parse(messages.prompt);
    assert.equal(payload.现有内容, "旧内容");
    assert.equal(payload.剧情资料, "世界设定");
    assert.equal(payload.创作要求, "扩写至150字");
  }
  assert.equal(systems.size, 4);
});
test("text route refuses unconfigured providers and invalid requests without mock output", async () => {
  const names = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY"];
  const old = names.map((name) => process.env[name]);
  names.forEach((name) => delete process.env[name]);
  try {
    const { POST } = load("app/api/ai/node-text/route.ts");
    const call = (body) =>
      POST(
        new Request("http://localhost/api/ai/node-text", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
    const invalid = await call({ ...input, instruction: "" });
    assert.equal(invalid.status, 400);
    const missing = await call(input);
    assert.equal(missing.status, 503);
    assert.match((await missing.json()).error, /配置/);
  } finally {
    names.forEach((name, i) =>
      old[i] === undefined ? delete process.env[name] : (process.env[name] = old[i]),
    );
  }
});
test("text transport diagnostics distinguish formats without leaking upstream bodies or credentials", () => {
  const { APICallError } = require("ai"),
    { textGenerationError } = load("lib/ai/text-error.ts");
  for (const [body, type, expected, classification] of [
    ["<!doctype html><html>private-response-body</html>", "text/html", /HTML/, "html"],
    ['data: {"private":"private-response-body"}\n\n', "text/event-stream", /SSE/, "stream"],
    ['{"answer":"private-response-body"}', "application/json", /结构不符合/, "json"],
    ["", "application/json", /空响应/, "empty"],
  ]) {
    const data = textGenerationError(
      new APICallError({
        message: "Invalid JSON response",
        url: "https://proxy.test/chat/completions",
        requestBodyValues: { key: "private-key" },
        statusCode: 200,
        responseBody: body,
        responseHeaders: { "content-type": type },
      }),
      { id: "openai", name: "test-model" },
    );
    assert.match(data.error, expected);
    assert.equal(data.details.responseType, classification);
    assert.equal(data.details.status, 200);
    assert.equal(JSON.stringify(data).includes("private-response-body"), false);
    assert.equal(JSON.stringify(data).includes("private-key"), false);
  }
});
test("diagnostic request URLs omit credentials and query values", () => {
  const { APICallError } = require("ai"),
    { textGenerationError } = load("lib/ai/text-error.ts");
  const result = textGenerationError(
    new APICallError({
      message: "Invalid JSON response",
      url: "https://user:private-key@proxy.test/chat/completions?key=private-key",
      requestBodyValues: { secret: "private-prompt" },
      statusCode: 200,
      responseBody: "private-response-body",
    }),
    { id: "openai", name: "test-model" },
  );
  assert.equal(JSON.stringify(result).includes("private-"), false);
  assert.equal(result.details.endpoint, "https://proxy.test/chat/completions");
});

async function streamingRoute(fn) {
  const names = [
    "TEXT_PROVIDER",
    "TEXT_BASE_URL",
    "TEXT_API_KEY",
    "TEXT_MODEL",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "DEEPSEEK_API_KEY",
  ];
  const old = names.map((name) => process.env[name]),
    fetch = global.fetch;
  names.forEach((name) => delete process.env[name]);
  Object.assign(process.env, {
    TEXT_PROVIDER: "openai",
    TEXT_BASE_URL: "https://proxy.test/api/proxy/forward",
    TEXT_API_KEY: "private-key",
    TEXT_MODEL: "test-model",
  });
  try {
    const { POST } = load("app/api/ai/node-text/route.ts");
    await fn((signal) =>
      POST(
        new Request("http://localhost/api/ai/node-text", {
          method: "POST",
          body: JSON.stringify(input),
          signal,
        }),
      ),
    );
  } finally {
    global.fetch = fetch;
    names.forEach((name, i) =>
      old[i] === undefined ? delete process.env[name] : (process.env[name] = old[i]),
    );
  }
}
function sseDelta(text, finish = null) {
  return `data: ${JSON.stringify({ id: "reply", object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{ index: 0, delta: text ? { content: text } : {}, finish_reason: finish }] })}\n\n`;
}
function splitStream(body) {
  const bytes = new TextEncoder().encode(body);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
test("node text requests SSE and collects fragmented Unicode deltas into one editable draft", () =>
  streamingRoute(async (call) => {
    let calls = 0;
    global.fetch = async (url, init) => {
      calls++;
      assert.equal(String(url), "https://proxy.test/api/proxy/forward/chat/completions");
      const body = JSON.parse(init.body);
      assert.equal(body.stream, true);
      assert.equal(body.model, "test-model");
      assert.equal(body.max_tokens, 2000);
      assert.ok(body.messages.some((message) => message.content.includes("扩写至150字")));
      return splitStream(
        sseDelta("小蝎子推开门。") +
          sseDelta("黄貂鼠终于开口。") +
          sseDelta("", "stop") +
          "data: [DONE]\n\n",
      );
    };
    const response = await call();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { text: "小蝎子推开门。黄貂鼠终于开口。" });
    assert.equal(calls, 1);
  }));
test("an error after partial text never returns a successful draft or retries the paid request", () =>
  streamingRoute(async (call) => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return splitStream(
        sseDelta("不完整的草稿") + 'data: {"error":{"message":"private-provider-error"}}\n\n',
      );
    };
    const response = await call(),
      body = await response.json();
    assert.equal(response.status, 502);
    assert.match(body.error, /文本流/);
    assert.equal(JSON.stringify(body).includes("不完整"), false);
    assert.equal(JSON.stringify(body).includes("private-provider-error"), false);
    assert.equal(calls, 1);
  }));
test("streaming authentication failures retain safe diagnostics and empty streams are rejected", () =>
  streamingRoute(async (call) => {
    global.fetch = async () =>
      Response.json({ error: { message: "private-provider-error" } }, { status: 401 });
    const failed = await call(),
      body = await failed.json();
    assert.equal(failed.status, 502);
    assert.match(body.error, /TEXT_API_KEY/);
    assert.equal(body.details.status, 401);
    assert.equal(JSON.stringify(body).includes("private-provider-error"), false);
    global.fetch = async () => splitStream(sseDelta("", "stop") + "data: [DONE]\n\n");
    const empty = await call();
    assert.equal(empty.status, 502);
    assert.match((await empty.json()).error, /未生成有效内容/);
  }));

test("premature EOF and user cancellation cannot produce a partial successful draft", () =>
  streamingRoute(async (call) => {
    global.fetch = async () => splitStream(sseDelta("不完整的草稿"));
    const early = await call(),
      earlyBody = await early.json();
    assert.equal(early.status, 502);
    assert.match(earlyBody.error, /未正常结束/);
    assert.equal(earlyBody.text, undefined);
    const controller = new AbortController();
    global.fetch = async (url, init) =>
      new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(new TextEncoder().encode(sseDelta("不完整的草稿")));
            init.signal.addEventListener("abort", () => stream.error(init.signal.reason), {
              once: true,
            });
            setTimeout(() => controller.abort(), 0);
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    const cancelled = await call(controller.signal),
      cancelledBody = await cancelled.json();
    assert.equal(cancelled.status, 502);
    assert.equal(cancelledBody.text, undefined);
  }));
