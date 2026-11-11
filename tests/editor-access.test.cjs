const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load-ts.cjs");
const { editorAuthorized, publicRoute, sameOriginMutation } = load("lib/access/editor.ts");
function environment(fn) {
  const previous = {
    mode: process.env.NODE_ENV,
    user: process.env.STORYREEL_EDITOR_USER,
    password: process.env.STORYREEL_EDITOR_PASSWORD,
  };
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries({
      NODE_ENV: previous.mode,
      STORYREEL_EDITOR_USER: previous.user,
      STORYREEL_EDITOR_PASSWORD: previous.password,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
test("production fails closed and configured editor credentials protect the workspace", () =>
  environment(() => {
    process.env.NODE_ENV = "production";
    delete process.env.STORYREEL_EDITOR_USER;
    delete process.env.STORYREEL_EDITOR_PASSWORD;
    const req = (authorization) =>
      new Request("https://story.test/api/projects", {
        headers: authorization ? { authorization } : {},
      });
    assert.equal(editorAuthorized(req()), false);
    process.env.STORYREEL_EDITOR_USER = "editor";
    process.env.STORYREEL_EDITOR_PASSWORD = "long-secret";
    assert.equal(
      editorAuthorized(req("Basic " + Buffer.from("editor:long-secret").toString("base64"))),
      true,
    );
    for (const value of [
      "Basic invalid",
      "Bearer long-secret",
      "Basic " + Buffer.from("editor:wrong").toString("base64"),
    ])
      assert.equal(editorAuthorized(req(value)), false);
  }));
test("unconfigured development access is limited to local hosts", () =>
  environment(() => {
    process.env.NODE_ENV = "development";
    delete process.env.STORYREEL_EDITOR_USER;
    delete process.env.STORYREEL_EDITOR_PASSWORD;
    assert.equal(editorAuthorized(new Request("http://localhost/api/projects")), true);
    assert.equal(editorAuthorized(new Request("http://example.com/api/projects")), false);
  }));
test("public allowlist does not expose project management and mutations reject cross-site origins", () => {
  for (const url of ["/player/abc", "/api/publications/abc", "/api/media/abc"])
    assert.equal(publicRoute(url), true);
  for (const url of [
    "/api/projects",
    "/api/projects/abc/publications",
    "/api/canvas/jobs",
    "/api/assets",
  ])
    assert.equal(publicRoute(url), false);
  assert.equal(
    sameOriginMutation(
      new Request("https://story.test/api/projects", {
        method: "POST",
        headers: { origin: "https://evil.test" },
      }),
    ),
    false,
  );
  assert.equal(
    sameOriginMutation(
      new Request("https://story.test/api/projects", {
        method: "POST",
        headers: { origin: "https://story.test" },
      }),
    ),
    true,
  );
});
