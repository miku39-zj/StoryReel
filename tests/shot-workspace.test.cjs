const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load-ts.cjs");
const { syncShotCanvas } = load("lib/production/canvas-shots.ts");
const { emptyProduction } = load("lib/production/types.ts");
const { shotWorkspaceGraph, mergeShotNodes, mergeShotEdges, chooseMainVideo, mainVideoNode } = load(
  "lib/canvas/shot-workspace.ts",
);
const { resolveShotOutputs } = load("lib/production/shot-outputs.ts");
const { fingerprint } = load("lib/canvas/workflow.ts");
const { playbackProject } = load("lib/story/graph.ts");
function fixture() {
  const shots = [0, 1].map((i) => ({
    shotId: `s${i}`,
    sceneId: "a",
    shotIndex: i,
    frameType: "中景",
    cameraMove: "fixed",
    lighting: "day",
    action: `action${i}`,
    duration: 5,
    imagePrompt: `frame${i}`,
    characterNames: [],
  }));
  return syncShotCanvas(
    {
      id: "test",
      name: "test",
      createdAt: "2026-11-06T00:00:00.000Z",
      updatedAt: "2026-11-06T00:00:00.000Z",
      startNodeId: "video_a",
      nodes: [
        {
          id: "video_a",
          type: "video",
          position: { x: 0, y: 0 },
          data: { nodeType: "video", title: "A" },
        },
        { id: "end", type: "ending", position: { x: 500, y: 0 }, data: { nodeType: "ending" } },
      ],
      edges: [{ id: "exit", source: "video_a", target: "end", data: { kind: "flow" } }],
      creation: { storyboardShots: shots },
    },
    emptyProduction("test"),
  );
}
function candidate(p, id = "candidate") {
  return {
    ...p,
    nodes: [
      ...p.nodes,
      {
        id,
        type: "video",
        position: { x: 1050, y: 170 },
        data: {
          nodeType: "video",
          title: id,
          canvasShotId: "s0",
          videoUrl: "/api/media/candidate",
          seedanceDuration: 5,
        },
      },
    ],
  };
}
test("one shot view hides story routes and all nodes belonging to another shot", () => {
  const p = fixture(),
    g = shotWorkspaceGraph(p, "s0");
  assert.deepEqual(g.nodes.map((n) => n.id).sort(), ["shot_frame:s0", "shot_text:s0", "video_a"]);
  assert.equal(g.edges.length, 2);
  assert.ok(g.edges.every((e) => e.data.kind === "context"));
});
test("scoped layout, deletion and edge edits preserve the other shot and story routes", () => {
  const p = fixture(),
    other = shotWorkspaceGraph(p, "s1"),
    g = shotWorkspaceGraph(p, "s0");
  const changed = g.nodes.map((n) => ({
    ...n,
    position: { x: n.position.x + 47, y: n.position.y + 36 },
  }));
  const next = mergeShotNodes(
    p,
    "s0",
    changed.filter((n) => n.id !== "shot_text:s0"),
  );
  assert.deepEqual(shotWorkspaceGraph(next, "s1"), other);
  assert.equal(
    next.nodes.find((n) => n.id === "video_a").position.x,
    p.nodes.find((n) => n.id === "video_a").position.x,
  );
  assert.equal(
    shotWorkspaceGraph(next, "s0").nodes.find((n) => n.id === "video_a").position.x,
    747,
  );
  const unlinked = mergeShotEdges(next, "s0", []);
  assert.ok(unlinked.edges.some((e) => e.id === "exit"));
  assert.ok(unlinked.edges.some((e) => e.target === "shot_video:s1" && e.data.kind === "context"));
});
test("shared reference deletion detaches locally; editing or deleting another shot is impossible", () => {
  let p = fixture();
  const ref = {
    id: "shared",
    type: "image",
    position: { x: 0, y: 0 },
    data: { nodeType: "image", title: "shared", imageUrl: "/api/media/ref" },
  };
  p.nodes.push(ref);
  p.edges.push(
    ...["s0", "s1"].map((id) => ({
      id: `ref-${id}`,
      source: "shared",
      target: `shot_frame:${id}`,
      data: { kind: "context", inputRole: "reference-image" },
    })),
  );
  const g = shotWorkspaceGraph(p, "s0");
  const next = mergeShotNodes(
    p,
    "s0",
    g.nodes.filter((n) => n.id !== "shared"),
  );
  assert.ok(next.nodes.some((n) => n.id === "shared"));
  assert.ok(next.edges.some((e) => e.id === "ref-s1"));
  assert.ok(!next.edges.some((e) => e.id === "ref-s0"));
  assert.throws(() => chooseMainVideo(p, "s0", "shot_video:s1"), /当前分镜/);
});
test("main choice drives preview and published playback while candidates stay outside story routing", () => {
  let p = chooseMainVideo(candidate(fixture()), "s0", "candidate");
  assert.equal(mainVideoNode(p, "s0").id, "candidate");
  const output = resolveShotOutputs(p);
  assert.equal(output.nodes.find((n) => n.id === "video_a").data.videoUrl, "/api/media/candidate");
  assert.ok(!output.nodes.some((n) => n.id === "candidate"));
  const playback = playbackProject(p);
  assert.equal(
    playback.nodes.find((n) => n.id === "video_a").data.videoUrl,
    "/api/media/candidate",
  );
  assert.ok(!playback.nodes.some((n) => n.id === "candidate"));
  p.nodes.find((n) => n.id === "candidate").data.videoUrl = undefined;
  assert.equal(resolveShotOutputs(p).nodes.find((n) => n.id === "video_a").data.videoUrl, "");
  assert.equal(mainVideoNode(p, "s0").id, "candidate");
});
test("deleting the default main keeps the routing slot, clears selection and permits choosing another candidate", () => {
  let p = candidate(fixture());
  const g = shotWorkspaceGraph(p, "s0");
  p = mergeShotNodes(
    p,
    "s0",
    g.nodes.filter((n) => n.id !== "video_a"),
  );
  assert.equal(mainVideoNode(p, "s0"), undefined);
  assert.ok(p.edges.some((e) => e.source === "video_a" && e.target === "shot_video:s1"));
  assert.ok(!shotWorkspaceGraph(p, "s0").nodes.some((n) => n.id === "video_a"));
  p = chooseMainVideo(p, "s0", "candidate");
  assert.equal(
    resolveShotOutputs(p).nodes.find((n) => n.id === "video_a").data.videoUrl,
    "/api/media/candidate",
  );
});
test("selected main with a later input edit or storyboard revision cannot publish an old video", () => {
  let p = candidate(fixture());
  const n = p.nodes.find((n) => n.id === "candidate");
  n.data.generationFingerprint = fingerprint(p, n.id);
  p = chooseMainVideo(p, "s0", "candidate");
  n.data.scenePrompt = "changed";
  assert.equal(
    resolveShotOutputs(p).nodes.find((n) => n.id === "video_a").data.videoUrl,
    undefined,
  );
  n.data.generationFingerprint = undefined;
  p.creation.storyboardShots[0].action = "new story";
  assert.equal(
    resolveShotOutputs(p).nodes.find((n) => n.id === "video_a").data.videoUrl,
    undefined,
  );
});
test("canvas main result reconciles to its exact shot without adopting a candidate from another shot", () => {
  const { reconcileCanvasAssets } = load("lib/production/canvas-assets.ts");
  const p = chooseMainVideo(candidate(fixture()), "s0", "candidate");
  const state = emptyProduction(p.id);
  reconcileCanvasAssets(p, state);
  assert.equal(
    state.assets.find((a) => a.kind === "video" && a.shotId === "s0").url,
    "/api/media/candidate",
  );
  assert.equal(state.assets.filter((a) => a.kind === "video" && a.shotId === "s1").length, 0);
});

const { applyShotAsset, fillShotCanvasResults } = load("lib/production/canvas-results.ts");
const { productionShots } = load("lib/production/shot-inputs.ts");
const { shotRevision } = load("lib/production/shots.ts");
function resultAsset(p, kind, id = kind) {
  return {
    id,
    shotId: "s0",
    sceneId: "a",
    kind,
    version: 1,
    url: `/api/media/${id}`,
    createdAt: p.createdAt,
    jobId: id,
    sourceRevision: shotRevision(productionShots(p)[0]),
    provider: "test",
  };
}
test("background results fill managed frame and empty main video, idempotently", () => {
  const p = fixture(),
    state = emptyProduction(p.id);
  state.assets = [resultAsset(p, "image"), resultAsset(p, "video")];
  state.selected = { s0: { image: "image", video: "video" } };
  const next = fillShotCanvasResults(p, state);
  assert.equal(next.nodes.find((n) => n.id === "shot_frame:s0").data.imageUrl, "/api/media/image");
  assert.equal(mainVideoNode(next, "s0").data.videoUrl, "/api/media/video");
  assert.equal(fillShotCanvasResults(next, state), next);
  assert.equal(mainVideoNode(resolveShotOutputs(next), "s0").data.videoUrl, "/api/media/video");
});
test("background completion preserves occupied main and never assigns old output to blank candidate", () => {
  const p = fixture(),
    asset = resultAsset(p, "video"),
    state = emptyProduction(p.id);
  state.assets = [asset];
  state.selected = { s0: { video: asset.id } };
  const occupied = applyShotAsset(p, { ...asset, id: "chosen", url: "/api/media/chosen" });
  assert.equal(
    mainVideoNode(fillShotCanvasResults(occupied, state), "s0").data.videoUrl,
    "/api/media/chosen",
  );
  const custom = chooseMainVideo(candidate(p), "s0", "candidate");
  custom.nodes.find((n) => n.id === "candidate").data.videoUrl = undefined;
  assert.equal(fillShotCanvasResults(custom, state), custom);
});
test("explicit video version updates selected main and clears previous segments; stale version stays stale", () => {
  let p = chooseMainVideo(candidate(fixture()), "s0", "candidate");
  p.nodes.find((n) => n.id === "candidate").data.segments = [{ videoUrl: "/old" }];
  const asset = resultAsset(p, "video");
  const next = applyShotAsset(p, asset);
  assert.equal(mainVideoNode(next, "s0").data.videoUrl, asset.url);
  assert.equal(mainVideoNode(next, "s0").data.segments, undefined);
  assert.equal(
    resolveShotOutputs(next).nodes.find((n) => n.id === "video_a").data.videoUrl,
    asset.url,
  );
  const stale = applyShotAsset(next, { ...asset, id: "old", sourceRevision: "old-storyboard" });
  assert.equal(
    resolveShotOutputs(stale).nodes.find((n) => n.id === "video_a").data.videoUrl,
    undefined,
  );
});

test("route workspace folds generated shot chains without changing branch targets", () => {
  const { routeWorkspaceGraph } = load("lib/canvas/route-workspace.ts");
  const project = fixture();
  const route = routeWorkspaceGraph(project.nodes, project.edges);
  assert.equal(route.tails.get("video_a"), "shot_video:s1");
  assert.ok(route.nodes.every((node) => !["text", "image"].includes(node.type)));
  assert.ok(route.edges.some((edge) => edge.source === "video_a"));
  assert.ok(project.edges.some((edge) => edge.source === "shot_video:s1"));
});

test("an outpoint frame becomes stale when the preceding selected video changes", () => {
  const { isStale } = load("lib/canvas/workflow.ts");
  const project = fixture();
  const source = project.nodes.find((node) => node.id === "video_a");
  const target = project.nodes.find((node) => node.id === "shot_video:s1");
  source.data.videoUrl = "/api/media/old";
  const frame = {
    id: "captured",
    type: "image",
    data: {
      nodeType: "image",
      imageUrl: "/api/media/frame",
      outpointSourceId: source.id,
      outpointVideoUrl: source.data.videoUrl,
    },
  };
  project.nodes.push(frame);
  project.edges.push({
    id: "captured-input",
    source: frame.id,
    target: target.id,
    data: { kind: "context", inputRole: "first-frame" },
  });
  assert.equal(isStale(project, frame), false);
  source.data.videoUrl = "/api/media/new";
  assert.equal(isStale(project, frame), true);
  assert.equal(isStale(project, target), true);
});

test("splitting at a key image preserves playback order and pins both boundary inputs", () => {
  const { splitShotAtImage } = load("lib/production/split-shot.ts");
  const project = fixture();
  const main = mainVideoNode(project, "s0");
  const first = project.nodes.find((node) => node.id === "shot_frame:s0");
  first.data.imageUrl = "/api/media/first";
  const input = project.edges.find((edge) => edge.source === first.id && edge.target === main.id);
  input.data.inputRole = "reference-image";
  project.nodes.push({
    id: "middle",
    type: "image",
    position: { x: 0, y: 0 },
    data: {
      nodeType: "image",
      imageUrl: "/api/media/middle",
      canvasShotId: "s0",
      middleKeyImage: true,
    },
  });
  project.edges.push({
    id: "mid-input",
    source: "middle",
    target: main.id,
    data: { kind: "context", inputRole: "reference-image" },
  });
  const split = splitShotAtImage(project, "s0", "middle", "split");
  assert.deepEqual(
    split.creation.storyboardShots.map(({ shotId, shotIndex }) => [shotId, shotIndex]),
    [
      ["s0", 0],
      ["split", 1],
      ["s1", 2],
    ],
  );
  assert.ok(
    split.edges.some((edge) => edge.source === "middle" && edge.data.inputRole === "last-frame"),
  );
  assert.ok(
    split.edges.some(
      (edge) => edge.source === "split_frame:split" && edge.data.inputRole === "first-frame",
    ),
  );
  assert.ok(
    split.edges.some(
      (edge) => edge.source === "shot_video:split" && edge.target === "shot_video:s1",
    ),
  );
});

test("a branch merge inherits agreed state and flags conflicting props", () => {
  const { sceneContinuity } = load("lib/story/continuity.ts");
  const project = {
    nodes: ["video_a", "video_b", "video_c"].map((id) => ({
      id,
      type: "video",
      data: { nodeType: "video" },
    })),
    edges: ["a", "b"].map((id) => ({ source: `video_${id}`, target: "video_c" })),
    creation: {
      storyOutline: {
        scenes: [
          { id: "a", title: "留岸", exitState: { time: "夜", props: "船票" } },
          { id: "b", title: "上船", exitState: { time: "夜", props: "无" } },
          { id: "c", title: "船舱" },
        ],
      },
    },
  };
  const result = sceneContinuity(project, "c");
  assert.equal(result.entry.time, "夜");
  assert.equal(result.entry.props, undefined);
  assert.match(result.warnings[0], /道具.*过渡镜头/);
});

test("video canvases open without storyboard shots and keep branch edges in the route", () => {
  const { videoWorkspaceId } = load("lib/canvas/shot-workspace.ts");
  const project = fixture();
  const first = {
    id: "opening",
    type: "video",
    position: { x: 0, y: 0 },
    data: { nodeType: "video" },
  };
  const second = { ...first, id: "ending" };
  const frame = { ...first, id: "frame", type: "image", data: { nodeType: "image" } };
  const flow = { id: "flow", source: first.id, target: second.id };
  const input = { id: "frame-input", source: frame.id, target: first.id };
  const draft = {
    ...project,
    creation: undefined,
    nodes: [first, second, frame],
    edges: [flow, input],
  };
  const id = videoWorkspaceId(first.id);
  assert.deepEqual(
    shotWorkspaceGraph(draft, id).nodes.map((node) => node.id),
    ["opening", "frame"],
  );
  assert.deepEqual(
    shotWorkspaceGraph(draft, videoWorkspaceId(second.id)).nodes.map((node) => node.id),
    ["ending"],
  );
  assert.deepEqual(mergeShotEdges(draft, id, []).edges, [flow]);
});
