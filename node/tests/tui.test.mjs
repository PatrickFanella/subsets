import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import React from "react";
import { render } from "ink-testing-library";
import { SubsetsApp } from "../../dist/tui.js";
import { Manager } from "../../dist/manager.js";
import { Store } from "../../dist/storage.js";
delete process.env.CODEX_HOME;
delete process.env.XDG_CONFIG_HOME;
const pause = () => new Promise((resolve) => setTimeout(resolve, 60));
test("TUI adopts, searches, groups, previews and confirms apply", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "subsets-tui-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, "home"),
    root = path.join(home, ".agents/skills");
  for (const name of ["poetry", "database"]) {
    const p = path.join(root, name);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(
      path.join(p, "SKILL.md"),
      `---\nname: ${name}\ndescription: Help with ${name}.\n---\n`,
    );
  }
  const manager = new Manager(
      new Store(path.join(dir, "state")),
      home,
      undefined,
      [],
      false,
    ),
    app = render(React.createElement(SubsetsApp, { manager }));
  t.after(() => app.unmount());
  const key = async (text) => {
    app.stdin.write(text);
    await pause();
  };
  await pause();
  assert.match(app.lastFrame(), /SUBSETS/);
  await key("2");
  await key("a");
  assert.match(app.lastFrame(), /Adopt this folder/);
  await key("y");
  assert.equal(Object.keys(manager.store.load().skills).length, 2);
  await key("1");
  await key("/");
  await key("poetry");
  await key("\r");
  assert.match(app.lastFrame(), /1 entries/);
  await key(" ");
  await key("g");
  await key("creative-writing");
  await key("\r");
  assert.equal(manager.store.load().groups["creative-writing"].length, 1);
  await key("3");
  await key("\u001b[B");
  await key(" ");
  await key("p");
  assert.match(app.lastFrame(), /Apply this reviewed selection/);
  assert.ok(fs.existsSync(path.join(root, "database")));
  await key("y");
  assert.ok(!fs.existsSync(path.join(root, "database")));
  assert.ok(fs.existsSync(path.join(root, "poetry")));
  assert.equal(manager.verify().verified, true);
});
