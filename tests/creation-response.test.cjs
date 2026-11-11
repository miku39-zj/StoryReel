const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  load = require("./load-ts.cjs");
const { readCreationJSON } = load("lib/ai/creation-response.ts");
test("creation response reader decodes fragmented UTF-8 and parses the complete structured result", async () => {
  const value = { title: "雨夜的旧钥匙", shots: [{ action: "林归还钥匙。" }] },
    text = "```json\n" + JSON.stringify(value) + "\n```",
    bytes = new TextEncoder().encode(text);
  let preview = "";
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 2) controller.enqueue(bytes.slice(i, i + 2));
        controller.close();
      },
    }),
  );
  assert.deepEqual(await readCreationJSON(response, (chunk) => (preview += chunk)), value);
  assert.equal(preview, text);
});
test("creation reader retains server validation errors and rejects malformed output", async () => {
  await assert.rejects(
    () => readCreationJSON(Response.json({ error: "分镜引用了不存在的场景" }, { status: 502 })),
    /分镜引用/,
  );
  await assert.rejects(() => readCreationJSON(new Response('intro {"ok":true}')));
  await assert.rejects(() => readCreationJSON(new Response('[{"shotId":')));
});
test("creation reader cancels abandoned results instead of applying stale project output", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"ok":true}'));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  await assert.rejects(
    () =>
      readCreationJSON(response, () => {
        throw new DOMException("项目已切换", "AbortError");
      }),
    /项目已切换/,
  );
  assert.equal(cancelled, true);
});

test("creation event stream reports progress and returns only its validated result", async () => {
  const { creationStream } = load("lib/ai/creation-stream.ts");
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const response = creationStream(
    new AbortController().signal,
    async (signal, onChunk) => {
      onChunk('{"title":"');
      await gate;
      onChunk('雨夜"}');
      return { title: "雨夜" };
    },
    () => ({ error: "校验失败" }),
  );
  let preview = "";
  const reading = readCreationJSON(response, (chunk) => (preview += chunk));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(preview, '{"title":"');
  release();
  assert.deepEqual(await reading, { title: "雨夜" });
  assert.equal(preview, '{"title":"雨夜"}');
});
test("creation event stream rejects failed validation and interrupted results", async () => {
  const { creationStream } = load("lib/ai/creation-stream.ts");
  const response = creationStream(
    new AbortController().signal,
    async (signal, chunk) => {
      chunk('{"title":"完整外观"}');
      throw Error("invalid");
    },
    () => ({ error: "故事缺少结局" }),
  );
  await assert.rejects(() => readCreationJSON(response), /故事缺少结局/);
  await assert.rejects(
    () =>
      readCreationJSON(
        new Response('{"type":"text","text":"{}"}\n', {
          headers: { "Content-Type": "application/x-ndjson" },
        }),
      ),
    /提前结束/,
  );
});
test("closing a creation stream aborts the upstream request", async () => {
  const { creationStream } = load("lib/ai/creation-stream.ts");
  let aborted = false;
  const response = creationStream(
    new AbortController().signal,
    (signal) =>
      new Promise((resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(signal.reason);
          },
          { once: true },
        );
      }),
    () => ({ error: "cancelled" }),
  );
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();
  assert.equal(aborted, true);
});
