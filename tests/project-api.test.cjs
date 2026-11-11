const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const load = require("./load-ts.cjs");
const { closeDatabases } = load("lib/server/database.ts");
let directory, previousRoot;
before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "storyreel-api-"));
  previousRoot = process.env.STORYREEL_DATA_DIR;
  process.env.STORYREEL_DATA_DIR = directory;
});
after(async () => {
  closeDatabases();
  if (previousRoot === undefined) delete process.env.STORYREEL_DATA_DIR;
  else process.env.STORYREEL_DATA_DIR = previousRoot;
  await fs.rm(directory, { recursive: true, force: true });
});
const collection = load("app/api/projects/route.ts");
const single = load("app/api/projects/[id]/route.ts");
const publish = load("app/api/projects/[id]/publish/route.ts");
const publications = load("app/api/publications/[id]/route.ts");
const context = (id) => ({ params: Promise.resolve({ id }) });
const request = (body) =>
  new Request("http://localhost/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const fixture = () => ({
  id: "api-project",
  name: "original",
  createdAt: "2026-10-28T00:00:00.000Z",
  updatedAt: "2026-10-29T00:00:00.000Z",
  startNodeId: "v",
  nodes: [
    {
      id: "v",
      type: "video",
      position: { x: 0, y: 0 },
      data: {
        nodeType: "video",
        title: "video",
        videoUrl: "https://example.com/video.mp4",
        scenePrompt: "private generation prompt",
      },
    },
    {
      id: "end",
      type: "ending",
      position: { x: 300, y: 0 },
      data: { nodeType: "ending", title: "Original ending" },
    },
  ],
  edges: [{ id: "ve", source: "v", target: "end", data: { kind: "flow" } }],
});

test("collection and item APIs share durable SQLite storage, preserve creation time and handle CRUD", async () => {
  const p = fixture();
  assert.equal((await collection.POST(request(p))).status, 201);
  const got = await single.GET(new Request("http://localhost"), context(p.id));
  assert.equal(got.status, 200);
  assert.equal((await got.json()).name, "original");
  assert.ok((await (await collection.GET()).json()).some((p) => p.id === "api-project"));
  const updated = await single.PUT(
    request({ name: "edited", revision: 1, createdAt: "2020-01-01T00:00:00.000Z" }),
    context(p.id),
  );
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).createdAt, p.createdAt);
  // A separate process with a fresh module cache sees persisted state.
  const { execFileSync } = require("node:child_process");
  const raw = execFileSync(
    process.execPath,
    [
      "-e",
      `require(${JSON.stringify(path.resolve(__dirname, "load-ts.cjs"))})('lib/server/projects.ts').getProject('api-project').then(p=>process.stdout.write(p.name))`,
    ],
    { env: process.env },
  );
  assert.equal(raw.toString(), "edited");
  assert.equal((await single.DELETE(new Request("http://localhost"), context(p.id))).status, 204);
  assert.equal((await single.GET(new Request("http://localhost"), context(p.id))).status, 404);
});

test("publication snapshots are immutable, portable, omit private production data, and validate on the server", async () => {
  const p = { ...fixture(), id: "publication-project" };
  let response = await publish.POST(request(p), context(p.id));
  assert.equal(response.status, 201);
  const { id, path: sharePath } = await response.json();
  assert.equal(sharePath, `/player/${id}`);
  const edited = structuredClone(p);
  edited.name = "edited";
  edited.nodes[1].data.title = "Changed ending";
  await collection.POST(
    new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { "If-Match": "1" },
      body: JSON.stringify(edited),
    }),
  );
  const publicResponse = await publications.GET(new Request("http://localhost"), context(id));
  const saved = await publicResponse.json();
  assert.equal(saved.project.name, "original");
  assert.equal(saved.project.nodes[1].data.title, "Original ending");
  assert.equal(saved.project.nodes[0].data.scenePrompt, undefined);
  p.nodes[0].data.videoUrl = "blob:local";
  response = await publish.POST(request(p), context(p.id));
  assert.equal(response.status, 422);
  p.nodes[0].data.videoUrl = "https://example.com/video.mp4";
  p.edges = [];
  assert.equal((await publish.POST(request(p), context(p.id))).status, 422);
  assert.equal(
    (await publications.GET(new Request("http://localhost"), context("missing"))).status,
    404,
  );
});

test("invalid requests and IDs fail before accessing storage", async () => {
  assert.equal((await collection.POST(request({ id: "../escape" }))).status, 400);
  assert.equal(
    (await single.GET(new Request("http://localhost"), context("../escape"))).status,
    400,
  );
  assert.equal(
    (await publications.GET(new Request("http://localhost"), context("../escape"))).status,
    400,
  );
  assert.equal((await publish.POST(request(fixture()), context("other-project"))).status, 400);
});
