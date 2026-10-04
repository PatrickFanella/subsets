import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const target = process.argv[2];
if (!target) throw Error("Pass a tarball or exact registry package version");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "subsets-package-"));
try {
  const install = spawnSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--prefix",
      temp,
      target,
    ],
    { cwd: temp, encoding: "utf8", timeout: 120000 },
  );
  assert.equal(install.status, 0, install.stderr);
  const exe = path.join(temp, "node_modules/.bin/subsets"),
    home = path.join(temp, "home"),
    root = path.join(home, ".agents/skills"),
    state = path.join(temp, "state");
  for (const name of ["poetry", "database"]) {
    const p = path.join(root, name);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(
      path.join(p, "SKILL.md"),
      `---\nname: ${name}\ndescription: Help with ${name}.\n---\n`,
    );
  }
  const options = [
    "--state",
    state,
    "--project",
    home,
    "--root",
    root,
    "--no-plugins",
  ];
  const run = (args) => {
    const p = spawnSync(process.execPath, [exe, ...options, ...args], {
      cwd: temp,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        CODEX_HOME: path.join(home, ".codex"),
        XDG_CONFIG_HOME: path.join(home, ".config"),
        PATH: "",
      },
    });
    assert.equal(p.status, 0, p.stderr);
    return JSON.parse(p.stdout);
  };
  run(["adopt", root]);
  run(["group", "create", "creative-writing", "poetry"]);
  run(["apply", "--creative-writing", "--dry-run"]);
  assert.ok(fs.existsSync(path.join(root, "database")));
  const receipt = run(["apply", "--creative-writing"]);
  assert.equal(fs.existsSync(path.join(root, "database")), false);
  assert.equal(run(["apply", "--creative-writing"]).changed, 0);
  assert.equal(run(["verify"]).verified, true);
  run(["rollback", receipt.transaction]);
  assert.ok(fs.existsSync(path.join(root, "database")));
  console.log(
    "Installed npm package passed adopt/group/dry-run/apply/idempotency/verify/rollback with no Python on PATH",
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
