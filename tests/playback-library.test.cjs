const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const load = require("./load-ts.cjs");
const { listPlaybackLibrary } = load("lib/server/playback-library.ts");
const { putProject, publishProject, revokePublication } = load("lib/server/projects.ts");
const { closeDatabases } = load("lib/server/database.ts");
const { outlineToProject } = load("lib/story/convert.ts");
test("playback library separates drafts from publications and falls back after revocation", async () => {
  const old = process.env.STORYREEL_DATA_DIR,
    temp = await fs.mkdtemp(path.join(os.tmpdir(), "storyreel-play-library-"));
  process.env.STORYREEL_DATA_DIR = temp;
  try {
    const project = outlineToProject(
      {
        title: "可观看",
        description: "",
        genre: "",
        characters: [],
        scenes: [
          { id: "one", title: "one", description: "", scenePrompt: "", order: 0, choices: [] },
        ],
      },
      "watchable",
      "可观看",
    );
    project.nodes[0].data.videoUrl = "/api/media/existing-video";
    await putProject(project);
    await putProject({
      ...project,
      id: "unfinished",
      name: "未完成",
      nodes: project.nodes.map((n) => ({ ...n, data: { ...n.data, videoUrl: undefined } })),
    });
    let items = await listPlaybackLibrary();
    assert.equal(items.find((i) => i.id === "watchable").status, "preview");
    assert.equal(items.find((i) => i.id === "unfinished").path, undefined);
    const published = await publishProject(project);
    items = await listPlaybackLibrary();
    const item = items.find((i) => i.id === "watchable");
    assert.equal(item.status, "published");
    assert.equal(item.path, `/player/${published.id}`);
    assert.equal(item.nodes, undefined);
    await revokePublication(project.id, published.id);
    items = await listPlaybackLibrary();
    assert.equal(items.find((i) => i.id === "watchable").status, "preview");
  } finally {
    closeDatabases();
    if (old === undefined) delete process.env.STORYREEL_DATA_DIR;
    else process.env.STORYREEL_DATA_DIR = old;
    await fs.rm(temp, { recursive: true, force: true });
  }
});
