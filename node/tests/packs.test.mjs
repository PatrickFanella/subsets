import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Manager } from "../../dist/manager.js";
import { Store } from "../../dist/storage.js";
import * as packs from "../../dist/packs.js";
delete process.env.CODEX_HOME;
delete process.env.XDG_CONFIG_HOME;
function skill(root, name) {
  const p = path.join(root, name);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(
    path.join(p, "SKILL.md"),
    `---\nname: ${name}\ndescription: Help with ${name}.\n---\n`,
  );
}
function fixture(t, { adopt = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "subsets-pack-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, "home"),
    root = path.join(home, ".agents/skills");
  skill(root, "poetry");
  skill(root, "bug-tracer");
  const manager = new Manager(
    new Store(path.join(dir, "state")),
    home,
    undefined,
    [],
    false,
  );
  if (adopt) manager.adopt(root);
  return { dir, root, manager };
}
// Builds what npm pack would unpack, without the network.
function fakeFetch(names, meta = {}) {
  return (spec, dest) => {
    assert.equal(spec, "@subcult/patstack@latest");
    const dir = path.join(dest, "unpacked/package");
    for (const n of names) skill(path.join(dir, "skills"), n);
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "@subcult/patstack",
        version: "0.1.0",
        subsets: { pack: "patstack", skills: "skills" },
        ...meta,
      }),
    );
    return { dir, version: "0.1.0", integrity: "sha512-test" };
  };
}
test("first run is offered once, never with the patstack backend or SUBSETS_NO_PACK", (t) => {
  const { manager } = fixture(t);
  assert.equal(packs.shouldOffer(manager, undefined, {}), true);
  assert.equal(packs.shouldOffer(manager, {}, {}), false);
  assert.equal(
    packs.shouldOffer(manager, undefined, { SUBSETS_NO_PACK: "1" }),
    false,
  );
  packs.decline(manager, "patstack");
  assert.equal(packs.shouldOffer(manager, undefined, {}), false);
  assert.equal(packs.list(manager)[0].decision, "declined");
});
test("adding imports inactive skills into a patstack group and keeps existing ones", (t) => {
  const { root, manager } = fixture(t),
    r = packs.add(manager, "patstack", {
      fetch: fakeFetch(["bug-tracer", "diff-inspector", "scope-grill"]),
    });
  assert.deepEqual(r.imported, ["diff-inspector", "scope-grill"]);
  assert.deepEqual(r.skipped, ["bug-tracer"]);
  assert.equal(r.group, "patstack");
  const d = manager.store.load();
  assert.equal(d.groups.patstack.length, 2);
  assert.equal(
    fs.existsSync(path.join(root, "diff-inspector")),
    false,
    "imported skills stay inactive",
  );
  assert.equal(packs.decisions(manager).patstack.version, "0.1.0");
  const current = Object.keys(manager.store.load().groups).find((g) =>
    g.startsWith("current-"),
  );
  manager.apply([current, "patstack"]);
  assert.equal(
    fs.existsSync(path.join(root, "diff-inspector", "SKILL.md")),
    true,
  );
  assert.throws(() => packs.remove(manager, "patstack"), /active/);
  manager.apply([current]);
  const removed = packs.remove(manager, "patstack");
  assert.deepEqual(removed.removed, ["diff-inspector", "scope-grill"]);
  assert.equal(manager.store.load().groups.patstack, undefined);
  assert.equal(
    fs.existsSync(path.join(manager.store.path, "packs/patstack")),
    false,
  );
  assert.equal(fs.existsSync(path.join(root, "poetry", "SKILL.md")), true);
});
test("adding again is idempotent", (t) => {
  const { manager } = fixture(t),
    fetch = fakeFetch(["diff-inspector"]);
  packs.add(manager, "patstack", { fetch });
  const again = packs.add(manager, "patstack", { fetch });
  assert.deepEqual(again.imported, []);
  assert.equal(manager.store.load().groups.patstack.length, 1);
});
test("without a managed folder the pack is registered read-only with a next step", (t) => {
  const { manager } = fixture(t, { adopt: false }),
    r = packs.add(manager, "patstack", {
      fetch: fakeFetch(["diff-inspector"]),
    });
  assert.deepEqual(r.imported, []);
  assert.equal(r.group, null);
  assert.match(r.next, /subsets adopt/);
  assert.equal(manager.store.load().searchRoots[r.folder], "readonly");
});
test("a package that is not the pack, or contains symlinks, is refused", (t) => {
  const { manager } = fixture(t);
  assert.throws(
    () =>
      packs.add(manager, "patstack", {
        fetch: fakeFetch(["x"], { name: "@evil/pack" }),
      }),
    /not the patstack pack/,
  );
  const linking = (spec, dest) => {
    const got = fakeFetch(["x"])(spec, dest);
    fs.symlinkSync("/etc/passwd", path.join(got.dir, "skills/x/leak"));
    return got;
  };
  assert.throws(
    () => packs.add(manager, "patstack", { fetch: linking }),
    /symlink/,
  );
  assert.throws(() => packs.add(manager, "nope"), /Unknown pack/);
});
