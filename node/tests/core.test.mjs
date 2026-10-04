import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { Manager } from "../../dist/manager.js";
import { Store, snapshot, equal, save } from "../../dist/storage.js";
import { roots, root, scan } from "../../dist/discovery.js";
delete process.env.CODEX_HOME;
delete process.env.XDG_CONFIG_HOME;
const CLI = path.resolve("dist/cli.js");
function skill(root, name) {
  const p = path.join(root, name);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(
    path.join(p, "SKILL.md"),
    `---\nname: ${name}\ndescription: Help with ${name}.\n---\n`,
  );
  fs.writeFileSync(path.join(p, "helper.sh"), "#!/bin/sh\nexit 0\n");
  fs.chmodSync(path.join(p, "helper.sh"), 0o755);
  return p;
}
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "subsets-node-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, "home"),
    root = path.join(home, ".agents/skills");
  for (const name of ["poetry", "editing", "database"]) skill(root, name);
  const manager = new Manager(
    new Store(path.join(dir, "state")),
    home,
    undefined,
    [],
    false,
  );
  return { dir, home, root, manager };
}
function adopted(t) {
  const f = fixture(t);
  f.receipt = f.manager.adopt(f.root);
  return f;
}
test("discovery is read-only and reports resource modes", (t) => {
  const { root, manager } = fixture(t),
    before = snapshot(root);
  assert.equal(manager.inventory().skills.length, 3);
  assert.deepEqual(snapshot(root), before);
  assert.equal(fs.existsSync(manager.store.path), false);
});
test("adoption preserves skills, resource modes and rollback", (t) => {
  const { root, manager } = fixture(t),
    before = snapshot(root),
    receipt = manager.adopt(root);
  for (const s of Object.values(manager.store.load().skills))
    assert.deepEqual(snapshot(s.source), before.entries[s.name]);
  manager.store.lock(() => manager.store.rollback(receipt.transaction), true);
  assert.deepEqual(snapshot(root), before);
});
test("core union, deactivation, unknown files, idempotency and rollback", (t) => {
  const { root, manager } = adopted(t);
  skill(root, "later");
  manager.editGroup("create", "writing", ["poetry"]);
  manager.editGroup("add", "core", ["editing"]);
  const reviewed = manager.plan(["writing"]);
  assert.ok(fs.existsSync(path.join(root, "database")));
  const receipt = manager.apply(["writing"], reviewed);
  assert.equal(receipt.changed, 1);
  assert.ok(fs.existsSync(path.join(root, "later")));
  assert.equal(manager.apply(["writing"]).changed, 0);
  assert.equal(manager.verify().verified, true);
  manager.store.lock(() => manager.store.rollback(receipt.transaction), true);
  assert.ok(fs.existsSync(path.join(root, "database")));
});
test("drift stops all mutations before changing another skill", (t) => {
  const { root, manager } = adopted(t);
  manager.editGroup("create", "writing", ["poetry"]);
  fs.writeFileSync(path.join(root, "poetry/SKILL.md"), "edited");
  const before = snapshot(root);
  assert.throws(() => manager.apply(["writing"]), /drift/);
  assert.deepEqual(snapshot(root), before);
});
test("later registry edits stop rollback", (t) => {
  const { manager } = adopted(t);
  manager.editGroup("create", "writing", ["poetry"]);
  const receipt = manager.apply(["writing"]);
  manager.editGroup("add", "writing", ["editing"]);
  assert.throws(
    () =>
      manager.store.lock(
        () => manager.store.rollback(receipt.transaction),
        true,
      ),
    /later edits/,
  );
});
test("interrupted replacement requires recovery and restores all paths", (t) => {
  const { root, manager } = adopted(t);
  manager.editGroup("create", "writing", ["poetry"]);
  const before = snapshot(root);
  assert.throws(
    () =>
      manager.apply(["writing"], undefined, () => {
        throw Error("injected interruption");
      }),
    /interruption/,
  );
  assert.throws(
    () => manager.editGroup("add", "writing", ["editing"]),
    /unfinished/,
  );
  const failed = manager.store.history().find((j) => j.status === "failed");
  manager.store.lock(() => manager.store.rollback(failed.id), true);
  assert.deepEqual(snapshot(root), before);
  assert.equal(manager.verify().verified, true);
});
test("changed backup refuses rollback", (t) => {
  const { manager } = adopted(t);
  manager.editGroup("create", "writing", ["poetry"]);
  const receipt = manager.apply(["writing"]),
    j = manager.store.history().find((x) => x.id === receipt.transaction),
    index = j.operations.findIndex((op) => op.action === "deactivate");
  fs.writeFileSync(
    path.join(
      manager.store.path,
      "transactions",
      receipt.transaction,
      "backups",
      String(index),
      "SKILL.md",
    ),
    "changed",
  );
  assert.throws(
    () =>
      manager.store.lock(
        () => manager.store.rollback(receipt.transaction),
        true,
      ),
    /backup changed/,
  );
});
test("concurrent writer lock excludes another operation", (t) => {
  const { manager } = fixture(t);
  manager.store.lock(() =>
    assert.throws(
      () => new Store(manager.store.path).lock(() => {}),
      /Another operation/,
    ),
  );
});
test("second registry cannot claim the same root", (t) => {
  const { root, manager, dir, home } = adopted(t);
  assert.throws(
    () =>
      new Manager(
        new Store(path.join(dir, "other")),
        home,
        undefined,
        [],
        false,
      ).adopt(root),
    /registry/,
  );
  assert.equal(manager.verify().verified, true);
});
test("linked, package and installer roots retain their owners", (t) => {
  const { dir, home, root: folder, manager } = fixture(t);
  const linked = path.join(dir, "linked");
  fs.symlinkSync(folder, linked);
  assert.throws(
    () =>
      new Manager(manager.store, home, undefined, [linked], false).adopt(
        linked,
      ),
    /symlink/,
  );
  fs.writeFileSync(path.join(home, ".agents/.skill-profile-state.json"), "{}");
  assert.throws(() => manager.adopt(folder), /skill-profile/);
  const packages = path.join(dir, "node_modules/demo/skills");
  skill(packages, "tool");
  assert.throws(
    () =>
      new Manager(manager.store, home, undefined, [packages], false).adopt(
        packages,
      ),
    /package/,
  );
});
test("invalid metadata is preserved during adoption", (t) => {
  const { root, manager } = fixture(t);
  fs.writeFileSync(path.join(root, "poetry/SKILL.md"), "invalid");
  const before = snapshot(path.join(root, "poetry")),
    r = manager.adopt(root);
  assert.deepEqual(r.preserved, ["poetry"]);
  manager.editGroup("create", "empty", []);
  manager.apply(["empty"]);
  assert.deepEqual(snapshot(path.join(root, "poetry")), before);
});
test("external resource links refuse canonical import", (t) => {
  const { dir, root, manager } = fixture(t);
  fs.writeFileSync(path.join(dir, "outside"), "private");
  fs.symlinkSync(path.join(dir, "outside"), path.join(root, "poetry/external"));
  assert.throws(() => manager.adopt(root), /External resource/);
  assert.equal(fs.existsSync(path.join(root, ".subsets-owner.json")), false);
});
test("read-only sources can be imported, with activation deferred", (t) => {
  const { dir, root, manager } = adopted(t);
  const source = path.join(dir, "sources");
  skill(source, "storytelling");
  manager.configureRoot(source);
  const ref = manager
    .inventory()
    .skills.find((s) => s.name === "storytelling").id;
  const result = manager.importSkill(ref, root);
  assert.equal(result.active, false);
  assert.equal(fs.existsSync(path.join(root, "storytelling")), false);
  manager.editGroup("create", "writing", ["storytelling"]);
  manager.apply(["writing"]);
  assert.equal(fs.existsSync(path.join(root, "storytelling/SKILL.md")), true);
});
test("ambiguous names require IDs and unknown groups fail", (t) => {
  const { dir, home, manager } = adopted(t);
  const second = path.join(dir, "second");
  skill(second, "poetry");
  manager.configureRoot(second, "unmanaged");
  manager.adopt(second);
  assert.throws(
    () => manager.editGroup("create", "writing", ["poetry"]),
    /Ambiguous/,
  );
  assert.throws(() => manager.plan(["typo"]), /Unknown group/);
  assert.throws(() => manager.editGroup("create", "dry-run", []), /conflicts/);
});
test("bounded project discovery excludes unrelated siblings", (t) => {
  const { dir, home } = fixture(t);
  const project = path.join(dir, "projects/one");
  skill(path.join(project, ".agents/skills"), "local");
  skill(path.join(dir, "projects/two/.agents/skills"), "sibling");
  const names = scan(roots(home, project, [], false)).skills.map((s) => s.name);
  assert.ok(names.includes("local"));
  assert.ok(!names.includes("sibling"));
});
test("native state rejects Python registries", (t) => {
  const { manager } = fixture(t);
  save(manager.store.registry, {
    version: 1,
    roots: {},
    skills: {},
    groups: { core: [] },
    activeGroups: [],
  });
  assert.throws(() => manager.store.load(), /native Node registry/);
});
test("CLI supports flags after command, dry-run, dynamic groups and rollback", (t) => {
  const { dir, root, home } = fixture(t),
    state = path.join(dir, "cli-state");
  const run = (args, status = 0) => {
    const p = spawnSync(
      process.execPath,
      [
        CLI,
        "--state",
        state,
        "--project",
        home,
        "--root",
        root,
        "--no-plugins",
        ...args,
      ],
      { encoding: "utf8", env: { ...process.env, HOME: home } },
    );
    assert.equal(p.status, status, p.stderr);
    return status === 0 ? JSON.parse(p.stdout) : p.stderr;
  };
  run(["adopt", root]);
  run(["group", "create", "writing", "poetry"]);
  run(["apply", "--writing", "--dry-run"]);
  assert.ok(fs.existsSync(path.join(root, "database")));
  const applied = run(["apply", "--writing"]);
  assert.equal(run(["apply", "--writing"]).changed, 0);
  assert.match(run(["apply", "--typo"], 2), /Unknown option/);
  assert.match(run(["adopt", root, "--dry-run"], 2), /supported/);
  run(["rollback", applied.transaction]);
  assert.equal(run(["verify", "--json"]).verified, true);
});

test("malformed registry groups are rejected before a mutation", (t) => {
  const { manager } = fixture(t);
  save(manager.store.registry, {
    version: 2,
    roots: {},
    skills: {},
    groups: { core: "invalid" },
    activeGroups: [],
    searchRoots: {},
  });
  assert.throws(
    () => manager.editGroup("create", "writing", []),
    /Invalid group/,
  );
});

test("existing profile edits preserve comments and can be rolled back", async (t) => {
  const { dir, home, manager } = fixture(t);
  const source = path.join(dir, "authoring");
  fs.mkdirSync(path.join(source, "profiles"), { recursive: true });
  fs.mkdirSync(path.join(source, "catalog"), { recursive: true });
  skill(path.join(source, "library/skills"), "storytelling");
  skill(path.join(source, "library/skills"), "blocked");
  save(path.join(source, "catalog/qualification.json"), {
    skills: { blocked: { status: "blocked" } },
  });
  fs.writeFileSync(
    path.join(source, "profiles/writing.txt"),
    "# Keep this comment\nstorytelling\n",
  );
  const { Legacy } = await import("../../dist/legacy.js");
  const legacy = new Legacy(source, home);
  assert.deepEqual(
    legacy.inventory().skills.map((s) => s.name),
    ["storytelling"],
  );
  const receipt = legacy.editGroup(manager.store, "remove", "writing", [
    "storytelling",
  ]);
  assert.equal(
    fs.readFileSync(path.join(source, "profiles/writing.txt"), "utf8"),
    "# Keep this comment\n",
  );
  assert.throws(
    () => legacy.editGroup(manager.store, "add", "writing", ["blocked"]),
    /eligible/,
  );
  assert.throws(
    () => legacy.editGroup(manager.store, "create", "core", []),
    /canonical/,
  );
  manager.store.lock(() => manager.store.rollback(receipt.transaction), true);
  assert.match(
    fs.readFileSync(path.join(source, "profiles/writing.txt"), "utf8"),
    /storytelling/,
  );
});
