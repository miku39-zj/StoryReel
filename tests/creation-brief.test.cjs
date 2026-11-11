const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load-ts.cjs");
const { creationBriefSchema, briefInstructions } = load("lib/story/creation-brief.ts");
const { validateStory, validateBranches } = load("lib/ai/output-validation.ts");
const { generateStory } = load("lib/ai/story-generation.ts");
const { newProject } = load("lib/story/new-project.ts");
const { outlineToProject } = load("lib/story/convert.ts");
const { validateShotDuration } = load("lib/production/shot-plan.ts");
const linear = {
  title: "雨夜",
  genre: "悬疑",
  description: "",
  characters: [],
  scenes: [
    { id: "a", title: "拾起", order: 0, choices: [{ label: "继续", leadsTo: "b" }] },
    { id: "b", title: "结局", order: 1, choices: [] },
  ],
};
const brief = (input = {}) => creationBriefSchema.parse(input);
function provider(result, capture = () => {}) {
  const model = {
    specificationVersion: "v1",
    provider: "offline",
    modelId: "offline",
    defaultObjectGenerationMode: "json",
    async doGenerate() {
      throw Error("Non streaming forbidden");
    },
    async doStream(options) {
      capture(options);
      return {
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: "text-delta", textDelta: JSON.stringify(result) });
            c.enqueue({
              type: "finish",
              finishReason: "stop",
              usage: { promptTokens: 3, completionTokens: 4 },
            });
            c.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };
  return { id: "offline", name: "offline", contextWindow: 128000, model };
}

test("brief distinguishes narrative form, automatic genre, constraints and reference descriptions", () => {
  const b = brief({ mode: "linear", genre: "自动", targetDurationSeconds: 120 });
  const prompt = briefInstructions(b);
  assert.ok(prompt.includes("线性故事"));
  assert.ok(prompt.includes("推断题材"));
  assert.equal(b.references.length, 0);
  assert.throws(() =>
    brief({ references: [{ id: "ref", name: "x", url: "https://external.test/private" }] }),
  );
  assert.throws(() => brief({ targetDurationSeconds: -1 }));
});
test("direct story generation uses one streaming model call with no tools and validates linear output", async () => {
  let calls = 0,
    options;
  const result = await generateStory(
    { prompt: "线性雨夜", brief: brief({ mode: "linear", genre: "自动" }) },
    provider(linear, (o) => {
      calls++;
      options = o;
    }),
  );
  assert.equal(result.title, "雨夜");
  assert.equal(calls, 1);
  assert.equal(options.tools?.length ?? 0, 0);
  assert.ok(JSON.stringify(options.prompt).includes("线性故事"));
  const invalid = structuredClone(linear);
  invalid.scenes[0].choices.push({ label: "绕路", leadsTo: "b" });
  await assert.rejects(
    () => generateStory({ prompt: "linear", brief: brief({ mode: "linear" }) }, provider(invalid)),
    /线性|短剧/,
  );
});
test("cyclic paths with exits are rejected in story and branch validation", () => {
  const cyclic = structuredClone(linear);
  cyclic.scenes[0].choices.unshift({ label: "重来", leadsTo: "a" });
  assert.throws(() => validateStory(cyclic), /循环/);
  assert.doesNotThrow(() => validateStory(cyclic, brief({ allowCycles: true })));
  const scenes = [
    { id: "a", order: 0, choices: [{ label: "继续", leadsTo: "b" }] },
    {
      id: "b",
      order: 1,
      choices: [
        { label: "循环", leadsTo: "a" },
        { label: "结束", leadsTo: "end" },
      ],
    },
    { id: "end", order: 2, choices: [] },
  ];
  assert.throws(
    () =>
      validateBranches(
        {
          decisionPoints: [
            {
              sceneId: "b",
              question: "走哪边",
              choices: [
                { label: "循环", targetSceneId: "a", consequence: "" },
                { label: "结束", targetSceneId: "end", consequence: "" },
              ],
            },
          ],
          endings: [{ sceneId: "end", title: "终", description: "" }],
        },
        scenes,
      ),
    /循环/,
  );
});
test("linear conversion uses automatic edges; reference nodes survive project/store serialization", () => {
  const graph = outlineToProject(linear, "brief-test", "线性");
  assert.equal(graph.nodes.filter((n) => n.type === "choice").length, 0);
  assert.ok(graph.edges.some((e) => e.source === "video_a" && e.target === "video_b"));
  const b = brief({
    mode: "character",
    genre: "奇幻",
    references: [{ id: "one", name: "服装", url: "/api/media/one", description: "red coat" }],
  });
  const p = newProject("canvas-character", "主角", b);
  assert.equal(p.nodes.length, 2);
  assert.equal(p.nodes[0].data.assetKind, "character");
  assert.ok(p.nodes[0].data.assetDescription.includes("奇幻"));
  assert.ok(p.nodes[0].data.assetDescription.includes("red coat"));
  assert.equal(p.creation.brief.references[0].description, "red coat");
  const { useCreationStore, creationSnapshot, restoreCreation } = load("stores/creation-store.ts");
  restoreCreation(p.creation);
  assert.deepEqual(creationSnapshot().brief, b);
  restoreCreation();
  assert.equal(useCreationStore.getState().brief.mode, "interactive");
  const board = newProject("storyboard", "完整剧本");
  assert.equal(board.creation.storyOutline, null);
});
test("duration validation uses each branch separately instead of summed footage", () => {
  const scenes = [
    { id: "a", order: 0, choices: [{ leadsTo: "b" }, { leadsTo: "c" }] },
    { id: "b", order: 1, choices: [] },
    { id: "c", order: 2, choices: [] },
  ];
  const shots = scenes.map((s) => ({ sceneId: s.id, duration: 5 }));
  assert.doesNotThrow(() =>
    validateShotDuration(shots, scenes, brief({ targetDurationSeconds: 10 })),
  );
  assert.throws(
    () => validateShotDuration(shots, scenes, brief({ targetDurationSeconds: 30 })),
    /目标/,
  );
});
test("storyboard agent has no image tools or image configuration dependency", () => {
  const { buildRegistry } = load("lib/ai/tools/tool-sets.ts");
  assert.equal(buildRegistry("storyboard").getActiveTools().length, 0);
});

test("story forms clear incompatible decisions and source snapshots survive project persistence", () => {
  const { storyBrief, storySource, sameStorySource } = load("lib/story/creation-brief.ts");
  const { useCreationStore, creationSnapshot, restoreCreation } = load("stores/creation-store.ts");
  const { parseProject } = load("lib/story/project-schema.ts");
  const original = storySource("蝎子精", brief({ mode: "interactive", decisionPoints: 2 }));
  restoreCreation();
  useCreationStore.setState({
    userPrompt: original.prompt,
    brief: original.brief,
    storyOutline: linear,
    appliedStorySource: original,
  });
  useCreationStore.getState().setBrief({ ...original.brief, mode: "linear" });
  assert.equal(useCreationStore.getState().brief.decisionPoints, undefined);
  assert.equal(useCreationStore.getState().appliedStorySource.brief.decisionPoints, 2);
  assert.equal(
    sameStorySource(original, storySource("蝎子精", useCreationStore.getState().brief)),
    false,
  );
  assert.equal(storyBrief(brief({ mode: "storyboard", decisionPoints: 2 })).mode, "linear");
  assert.doesNotThrow(() => validateStory(linear, brief({ mode: "linear", decisionPoints: 2 })));
  const pending = storySource("新创意", brief({ mode: "linear" }));
  useCreationStore.setState({ pendingStoryOutline: linear, pendingStorySource: pending });
  const project = newProject();
  project.creation = creationSnapshot();
  const restored = parseProject(project);
  restoreCreation(restored.creation);
  assert.deepEqual(useCreationStore.getState().pendingStorySource, pending);
  assert.deepEqual(useCreationStore.getState().appliedStorySource, original);
  assert.equal(sameStorySource(pending, storySource("新创意", brief({ mode: "linear" }))), true);
  assert.equal(sameStorySource(pending, storySource("修改", brief({ mode: "linear" }))), false);
  restoreCreation();
});

test("story streaming uses selected cast and preserves authored appearance", async () => {
  const character = {
    id: "lin",
    revision: 1,
    name: "林",
    description: "短发，红色外套",
    imageUrl: "/api/media/lin",
  };
  const castBrief = brief({ mode: "linear", characters: [character] });
  const result = {
    ...linear,
    characters: [{ name: "林", role: "主角", description: "模型改成蓝衣" }],
  };
  let options;
  const story = await generateStory(
    { prompt: "林的故事", brief: castBrief },
    provider(result, (o) => (options = o)),
  );
  assert.equal(story.characters[0].description, character.description);
  assert.ok(JSON.stringify(options.prompt).includes(character.description));
  await assert.rejects(
    () => generateStory({ prompt: "林的故事", brief: castBrief }, provider(linear)),
    /缺少已选角色：林/,
  );
});
