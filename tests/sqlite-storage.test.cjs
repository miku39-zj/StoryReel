const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);
const load = require("./load-ts.cjs");
const { getDatabase, closeDatabases, transaction, writeWorkerHeartbeat, workerIsOnline } =
  load("lib/server/database.ts");
const { databasePath } = load("lib/server/storage-path.ts");
const {
  getProject,
  putProject,
  deleteProject,
  getPublication,
  publishProject,
  revokePublication,
  listProjects,
} = load("lib/server/projects.ts");
const { getProduction, updateProduction } = load("lib/server/production-store.ts");
const { listAssets } = load("lib/server/assets.ts");
const now = "2026-10-30T00:00:00.000Z";
const fixture = (id = "old") => ({
  id,
  name: "old project",
  createdAt: now,
  updatedAt: now,
  nodes: [],
  edges: [],
  revision: 4,
});
async function isolated(action) {
  closeDatabases();
  const previous = process.env.STORYREEL_DATA_DIR,
    root = await fs.mkdtemp(path.join(os.tmpdir(), "storyreel-sqlite-"));
  process.env.STORYREEL_DATA_DIR = root;
  try {
    await action(root);
  } finally {
    closeDatabases();
    if (previous === undefined) delete process.env.STORYREEL_DATA_DIR;
    else process.env.STORYREEL_DATA_DIR = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
}
async function legacy(root, collection, id, value) {
  await fs.mkdir(path.join(root, collection), { recursive: true });
  await fs.writeFile(path.join(root, collection, id + ".json"), JSON.stringify(value));
}

test("legacy projects, publications, jobs, version selections and uploaded metadata migrate without moving media", () =>
  isolated(async (root) => {
    const project = fixture(),
      publication = {
        id: "public",
        projectId: "old",
        publishedAt: now,
        project: { ...project, name: "published snapshot" },
      };
    const production = {
      projectId: "old",
      revision: 7,
      jobs: [
        {
          id: "job",
          status: "running",
          stage: "polling",
          providerTask: { requestId: "external-task" },
        },
      ],
      assets: [
        {
          id: "version",
          sceneId: "scene",
          shotId: "shot",
          kind: "image",
          version: 1,
          url: "/api/media/image",
          createdAt: now,
        },
      ],
      selected: { shot: { image: "version" } },
      requestKeys: ["request"],
    };
    await legacy(root, "projects", "old", project);
    await legacy(root, "publications", "public", publication);
    await legacy(root, "production", "old", production);
    const asset = {
      id: "upload",
      name: "uploaded image",
      type: "image",
      url: "/api/media/upload",
      createdAt: now,
    };
    await legacy(root, "assets", "upload", asset);
    await fs.mkdir(path.join(root, "media"));
    await fs.writeFile(path.join(root, "media", "upload.png"), Buffer.from([1, 2, 3]));
    await fs.writeFile(path.join(root, "worker-heartbeat"), String(Date.now()));
    assert.equal((await getProject("old")).revision, 4);
    assert.deepEqual(await getPublication("public"), publication);
    assert.deepEqual(await getProduction("old"), production);
    assert.ok((await listAssets()).some((a) => a.id === "upload"));
    assert.equal(workerIsOnline(), true);
    assert.equal(
      (await fs.readFile(databasePath())).subarray(0, 16).toString(),
      "SQLite format 3\0",
    );
    assert.deepEqual(
      await fs.readFile(path.join(root, "media", "upload.png")),
      Buffer.from([1, 2, 3]),
    );
    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(root, "projects", "old.json"), "utf8")),
      project,
    );
    const db = getDatabase();
    assert.equal(db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  }));

test("migration runs once, so retained JSON cannot overwrite updates or resurrect deletions and revoked publications", () =>
  isolated(async (root) => {
    await legacy(root, "projects", "old", fixture());
    await legacy(root, "publications", "public", {
      id: "public",
      projectId: "old",
      publishedAt: now,
      project: fixture(),
    });
    assert.equal((await getProject("old")).name, "old project");
    const updated = await putProject({ ...fixture(), name: "sqlite edit" }, 4);
    closeDatabases();
    assert.equal((await getProject("old")).name, "sqlite edit");
    assert.equal((await getProject("old")).revision, updated.revision);
    await deleteProject("old");
    await revokePublication("old", "public");
    closeDatabases();
    assert.equal(await getProject("old"), null);
    assert.equal(await getPublication("public"), null);
    assert.equal((await fs.readdir(path.join(root, "projects"))).length, 1);
  }));

test("malformed or invalid legacy records roll back the entire import and can be corrected and retried", () =>
  isolated(async (root) => {
    await legacy(root, "projects", "old", fixture());
    await fs.mkdir(path.join(root, "assets"));
    await fs.writeFile(path.join(root, "assets", "broken.json"), "{invalid");
    assert.throws(() => getDatabase(), /旧数据迁移失败 assets\/broken.json/);
    const { DatabaseSync } = require("node:sqlite");
    const raw = new DatabaseSync(databasePath());
    assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 0);
    raw.close();
    await legacy(root, "assets", "broken", { id: "broken", type: "unsupported", createdAt: now });
    assert.throws(() => getDatabase(), /旧数据迁移失败/);
    await fs.rm(path.join(root, "assets", "broken.json"));
    assert.equal((await listProjects()).length, 1);
  }));

test("SQLite is authoritative after migration and new writes create no metadata JSON files", () =>
  isolated(async (root) => {
    const saved = await putProject(fixture("db-only"), 0);
    assert.equal(saved.revision, 1);
    await publishProject(saved);
    await updateProduction("db-only", (state) => {
      state.requestKeys = ["durable"];
    });
    writeWorkerHeartbeat();
    const files = await fs.readdir(root);
    assert.ok(files.includes("storyreel.sqlite"));
    assert.ok(
      !files.some((f) =>
        ["projects", "publications", "production", "assets", "worker-heartbeat"].includes(f),
      ),
    );
    closeDatabases();
    assert.equal((await getProduction("db-only")).requestKeys[0], "durable");
    assert.equal(workerIsOnline(), true);
  }));

test("production mutations roll back on failure and do not increment revision for reads", () =>
  isolated(async () => {
    await updateProduction("transaction", (s) => {
      s.requestKeys = ["first"];
    });
    const before = await getProduction("transaction");
    await assert.rejects(
      updateProduction("transaction", (s) => {
        s.requestKeys.push("partial");
        throw Error("rollback");
      }),
      /rollback/,
    );
    assert.deepEqual(await getProduction("transaction"), before);
    await updateProduction("transaction", () => null);
    assert.deepEqual(await getProduction("transaction"), before);
    assert.throws(
      () =>
        transaction(getDatabase(), () => {
          throw Error("failed transaction");
        }),
      /failed transaction/,
    );
    await updateProduction("transaction", (s) => {
      s.requestKeys.push("next");
    });
    assert.equal((await getProduction("transaction")).revision, before.revision + 1);
  }));

test("independent processes serialize project revisions and production updates without lost writes", () =>
  isolated(async () => {
    await putProject(fixture("shared"), 0);
    const loader = JSON.stringify(path.join(__dirname, "load-ts.cjs"));
    const writer = `const load=require(${loader});load('lib/server/projects.ts').putProject({...${JSON.stringify(fixture("shared"))},name:process.argv[1]},1).then(()=>process.stdout.write('saved')).catch(e=>{if(e.message.includes('其他窗口'))process.stdout.write('conflict');else{console.error(e);process.exitCode=1;}});`;
    const outputs = await Promise.all(
      ["a", "b", "c"].map((name) =>
        run(process.execPath, ["-e", writer, name], { env: process.env }),
      ),
    );
    assert.deepEqual(outputs.map((r) => r.stdout).sort(), ["conflict", "conflict", "saved"]);
    assert.equal((await getProject("shared")).revision, 2);
    const mutate = `const load=require(${loader});load('lib/server/production-store.ts').updateProduction('shared',s=>{s.requestKeys??=[];s.requestKeys.push(process.argv[1]);}).catch(e=>{console.error(e);process.exitCode=1;});`;
    await Promise.all(
      ["one", "two", "three", "four"].map((value) =>
        run(process.execPath, ["-e", mutate, value], { env: process.env }),
      ),
    );
    assert.deepEqual((await getProduction("shared")).requestKeys.sort(), [
      "four",
      "one",
      "three",
      "two",
    ]);
  }));
