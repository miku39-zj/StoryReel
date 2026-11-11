const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const load = require("./load-ts.cjs");
const { addCharacterToProject } = load("lib/characters.ts");
const { initializeCharacterAssets } = load("lib/story/character-design.ts");
const { creationBriefSchema, briefInstructions } = load("lib/story/creation-brief.ts");
const asset = {
  id: "actor",
  revision: 1,
  name: "林",
  description: "黑色短发，红色外套",
  imageUrl: "/api/media/actor",
  style: "anime",
};
test("selected cast survives brief parsing and seeds reusable versioned character images", () => {
  const brief = creationBriefSchema.parse({ characters: [asset] });
  assert.ok(briefInstructions(brief).includes(asset.description));
  assert.ok(!briefInstructions(brief).includes(asset.imageUrl));
  const project = {
    id: "story",
    name: "故事",
    nodes: [],
    edges: [],
    creation: {
      brief,
      storyOutline: { characters: [{ name: "林", description: "untrusted change" }] },
    },
  };
  const imported = initializeCharacterAssets(project);
  assert.equal(imported.nodes.length, 1);
  assert.equal(imported.nodes[0].data.imageUrl, asset.imageUrl);
  assert.equal(imported.nodes[0].data.assetDescription, asset.description);
  assert.equal(imported.nodes[0].data.characterAssetRevision, 1);
  assert.equal(addCharacterToProject(imported, asset), imported);
  asset.description = "changed later";
  assert.equal(imported.nodes[0].data.assetDescription, "黑色短发，红色外套");
  assert.equal(project.nodes.length, 0);
});
test("character library persists independently and refuses lost updates", () => {
  const previous = process.env.STORYREEL_DATA_DIR;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "storyreel-character-"));
  process.env.STORYREEL_DATA_DIR = root;
  const { closeDatabases } = load("lib/server/database.ts");
  const { saveCharacter, listCharacters } = load("lib/server/characters.ts");
  try {
    const first = saveCharacter({
      name: "测试角色",
      description: "银色长发",
      imageUrl: "/api/media/reference",
    });
    closeDatabases();
    assert.equal(listCharacters()[0].imageUrl, "/api/media/reference");
    const updated = saveCharacter({ ...first, description: "银色长发，蓝色外套" });
    assert.equal(updated.revision, 2);
    assert.throws(() => saveCharacter(first), /角色已更新/);
    assert.equal(listCharacters().length, 1);
    assert.throws(() => saveCharacter({ name: " ", description: "x" }));
    assert.throws(() =>
      saveCharacter({ name: "x", description: "x", imageUrl: "javascript:alert(1)" }),
    );
  } finally {
    closeDatabases();
    if (previous === undefined) delete process.env.STORYREEL_DATA_DIR;
    else process.env.STORYREEL_DATA_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("importing a designed role upgrades an unbound script card without breaking its edges", () => {
  const project = {
    nodes: [
      {
        id: "role",
        type: "image",
        position: { x: 10, y: 20 },
        data: { assetKind: "character", title: "林" },
      },
    ],
    edges: [{ id: "link", source: "role", target: "frame" }],
  };
  const result = addCharacterToProject(project, { ...asset, description: "固定外观" });
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].id, "role");
  assert.equal(result.nodes[0].data.imageUrl, asset.imageUrl);
  assert.equal(result.edges[0].source, "role");
});
