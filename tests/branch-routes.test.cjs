const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  load = require("./load-ts.cjs");
const { resolveBranchRoutes } = load("lib/story/branch-routes.ts");
const { validateBranches } = load("lib/ai/output-validation.ts");
const { applyBranchDesign } = load("lib/story/apply-branches.ts");
const scenes = Array.from({ length: 6 }, (_, index) => ({
  id: String(index + 1),
  order: index,
  title: String(index + 1),
  scenePrompt: "scene",
  choices:
    index === 0
      ? [{ label: "继续", leadsTo: "2" }]
      : index === 1
        ? [
            { label: "归还", leadsTo: "3" },
            { label: "寻找", leadsTo: "4" },
          ]
        : index === 2
          ? [{ label: "告别", leadsTo: "5" }]
          : index === 3
            ? [{ label: "打开", leadsTo: "6" }]
            : [],
}));
const design = {
  decisionPoints: [
    {
      sceneId: "2",
      question: "如何处理钥匙？",
      choices: [
        { label: "归还", targetSceneId: "3", consequence: "告别" },
        { label: "寻找", targetSceneId: "4", consequence: "发现信件" },
      ],
    },
  ],
  endings: [
    { sceneId: "5", title: "告别", description: "" },
    { sceneId: "6", title: "信件", description: "" },
  ],
};
const project = {
  id: "branch-route",
  nodes: scenes.map((scene) => ({
    id: "video_" + scene.id,
    type: "video",
    position: { x: 0, y: 0 },
    data: { nodeType: "video", videoUrl: "/api/media/original" },
  })),
  edges: [],
  startNodeId: "video_1",
};
test("nonadjacent branch continuations are preserved by both validation and canvas application", () => {
  const routes = resolveBranchRoutes(scenes, design);
  assert.equal(routes.get("3")[0].leadsTo, "5");
  assert.equal(routes.get("4")[0].leadsTo, "6");
  assert.deepEqual(validateBranches(design, scenes), design);
  const applied = applyBranchDesign(project, { title: "钥匙", scenes }, design);
  for (const [source, target] of [
    ["3", "5"],
    ["4", "6"],
  ])
    assert.ok(
      applied.edges.some(
        (edge) => edge.source === "video_" + source && edge.target === "video_" + target,
      ),
    );
  assert.equal(
    applied.edges.some((edge) => edge.source === "video_3" && edge.target === "video_4"),
    false,
  );
  assert.ok(
    applied.nodes
      .filter((node) => node.type === "video")
      .every((node) => node.data.videoUrl === "/api/media/original"),
  );
  assert.deepEqual(project.edges, []);
});
test("legacy scenes without authored continuations retain order-based fallback", () => {
  const ordered = scenes.map((scene) => {
    const result = { ...scene };
    delete result.choices;
    return result;
  });
  const fallback = {
    decisionPoints: [
      {
        sceneId: "1",
        question: "路线？",
        choices: [
          { label: "一", targetSceneId: "2", consequence: "" },
          { label: "二", targetSceneId: "4", consequence: "" },
        ],
      },
    ],
    endings: [
      { sceneId: "3", title: "一", description: "" },
      { sceneId: "6", title: "二", description: "" },
    ],
  };
  const routes = resolveBranchRoutes(ordered, fallback);
  assert.equal(routes.get("2")[0].leadsTo, "3");
  assert.equal(routes.get("4")[0].leadsTo, "5");
});
test("unknown continuation targets and unreachable endings are rejected before canvas mutation", () => {
  for (const target of ["missing", "4"]) {
    const broken = structuredClone(scenes);
    broken[2].choices = [{ label: "继续", leadsTo: target }];
    assert.throws(() => validateBranches(design, broken), /不存在|无法到达/);
    assert.throws(
      () => applyBranchDesign(project, { title: "钥匙", scenes: broken }, design),
      /不存在|无法到达/,
    );
  }
  assert.equal(project.nodes.length, 6);
  assert.deepEqual(project.edges, []);
});
