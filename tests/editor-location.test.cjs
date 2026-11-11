const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load-ts.cjs");
const { readEditorLocation, editorHash } = load("lib/editor/location.ts");

test("workspace and every creation step survive a URL round trip", () => {
  for (const step of ["story", "branch", "storyboard", "visual", "video", "validate"]) {
    assert.deepEqual(readEditorLocation(editorHash("creation", step)), {
      workspace: "creation",
      step,
    });
  }
  for (const workspace of ["canvas", "preview"]) {
    assert.deepEqual(readEditorLocation(editorHash(workspace, "visual")), { workspace });
  }
});
test("legacy links remain valid and unknown locations fall back safely", () => {
  assert.deepEqual(readEditorLocation("#creation"), { workspace: "creation" });
  assert.deepEqual(readEditorLocation("#creation:unknown"), { workspace: "creation" });
  assert.deepEqual(readEditorLocation(""), { workspace: "canvas" });
  assert.deepEqual(readEditorLocation("#unknown:visual"), { workspace: "canvas" });
});
