const { test } = require("node:test");
const assert = require("node:assert/strict");
const { StoryRuntime } = require("./load-ts.cjs")("lib/story/runtime.ts");
const node = (id, nodeType) => ({
  id,
  type: nodeType,
  data: { nodeType, title: id },
  position: { x: 0, y: 0 },
});
const edge = (id, source, target) => ({ id, source, target, data: { choiceLabel: id } });

test("a visible choice through a choice node advances to its video scene", () => {
  const runtime = new StoryRuntime(
    [
      node("start", "video"),
      node("choice", "choice"),
      node("scene", "video"),
      node("end", "ending"),
    ],
    [
      edge("to-choice", "start", "choice"),
      edge("option-a", "choice", "scene"),
      edge("finish", "scene", "end"),
    ],
    "start",
  );
  assert.deepEqual(
    runtime.getChoices().map((c) => c.edgeId),
    ["option-a"],
  );
  assert.equal(runtime.choose("option-a").id, "scene");
  assert.equal(runtime.choose("finish").id, "end");
  assert.equal(runtime.isTerminal(), true);
  runtime.reset();
  assert.equal(runtime.current.id, "start");
  assert.deepEqual(runtime.history, ["start"]);
});

test("direct branches still work and unrelated edges cannot be chosen", () => {
  const runtime = new StoryRuntime(
    [node("start", "video"), node("left", "video"), node("right", "ending")],
    [
      edge("go-left", "start", "left"),
      edge("go-right", "start", "right"),
      edge("later", "left", "right"),
    ],
    "start",
  );
  assert.throws(() => runtime.choose("later"), /not found/);
  assert.equal(runtime.current.id, "start");
  assert.equal(runtime.choose("go-right").id, "right");
});

test("unlabelled routes display scene titles instead of internal edge IDs", () => {
  const runtime = new StoryRuntime(
    [node("start", "video"), node("next-scene", "video")],
    [{ id: "internal-edge", source: "start", target: "next-scene" }],
    "start",
  );
  assert.equal(runtime.getChoices()[0].label, "next-scene");
});
