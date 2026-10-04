import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exists } from "../../dist/storage.js";
import { root, scan } from "../../dist/discovery.js";
import { Legacy } from "../../dist/legacy.js";

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "subsets-discovery-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function skill(base, name) {
  const dir = path.join(base, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Help with ${name}.\n---\n`,
  );
}

test("paths beneath files are absent without hiding filesystem errors", (t) => {
  const dir = fixture(t),
    marker = path.join(dir, "marker"),
    linked = path.join(dir, "linked-marker"),
    dangling = path.join(dir, "dangling");
  fs.writeFileSync(marker, "installer marker");
  fs.symlinkSync(marker, linked);
  fs.symlinkSync(path.join(dir, "missing"), dangling);
  assert.equal(exists(path.join(marker, "SKILL.md")), false);
  assert.equal(exists(path.join(linked, "SKILL.md")), false);
  assert.equal(exists(path.join(dir, "missing")), false);
  assert.equal(exists(dangling), true);
  assert.throws(() => exists("\0"), { code: "ERR_INVALID_ARG_VALUE" });
});

test("discovery continues past ordinary files and linked files", (t) => {
  const dir = fixture(t);
  skill(dir, "a-first");
  skill(dir, "z-last");
  const marker = path.join(dir, "b-marker");
  fs.writeFileSync(marker, "installer marker");
  fs.symlinkSync(marker, path.join(dir, "c-linked-marker"));
  const result = scan([root(dir)]);
  assert.deepEqual(
    result.skills.map((s) => s.name),
    ["a-first", "z-last"],
  );
  assert.deepEqual(result.warnings, []);
});

test("existing profiles ignore marker files and still reserve owned skills", (t) => {
  const dir = fixture(t),
    home = path.join(dir, "home"),
    source = path.join(dir, "authoring"),
    system = path.join(home, ".codex/skills/.system"),
    shared = path.join(source, "shared"),
    library = path.join(source, "library/skills");
  skill(system, "system-tool");
  skill(shared, "shared-tool");
  for (const name of ["system-tool", "shared-tool", "optional-tool"])
    skill(library, name);
  fs.writeFileSync(
    path.join(system, ".codex-system-skills.marker"),
    "installer marker\n",
  );
  const marker = path.join(shared, "00-marker");
  fs.writeFileSync(marker, "installer marker");
  fs.symlinkSync(marker, path.join(shared, "01-linked-marker"));
  const result = new Legacy(source, home).inventory();
  assert.deepEqual(
    result.skills.map((s) => s.name),
    ["optional-tool"],
  );
  assert.deepEqual(result.warnings, []);
});
