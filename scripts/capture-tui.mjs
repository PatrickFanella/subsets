// Capture the real Ink component with disposable sample skills, never user state.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import React from "react";
import { render } from "ink-testing-library";
import { SubsetsApp } from "../dist/tui.js";
import { Manager } from "../dist/manager.js";
import { Store } from "../dist/storage.js";
delete process.env.CODEX_HOME;
delete process.env.XDG_CONFIG_HOME;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "subsets-brand-capture-"));
let app;
try {
  const home = path.join(dir, "home");
  const root = path.join(home, ".agents/skills");
  const examples = {
    editing: "Review structure, clarity and voice in a draft.",
    research: "Gather sources and check the claims in a draft.",
    storytelling: "Develop characters, scenes and narrative structure.",
    testing: "Verify application behavior with focused tests.",
    typescript: "Work with TypeScript types and application code.",
    publishing: "Prepare copy and assets for a reviewed release.",
  };
  for (const [name, description] of Object.entries(examples)) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    fs.writeFileSync(
      path.join(root, name, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\n---\n`,
    );
  }
  const manager = new Manager(
    new Store(path.join(dir, "state")),
    home,
    undefined,
    [],
    false,
  );
  const rootId = manager.inventory().roots.find((r) => r.path === root).id;
  manager.adopt(rootId);
  manager.editGroup("create", "creative-writing", [
    "editing",
    "research",
    "storytelling",
  ]);
  manager.editGroup("create", "development", ["testing", "typescript"]);
  manager.apply(["creative-writing"]);
  app = render(React.createElement(SubsetsApp, { manager }));
  Object.defineProperty(app.stdout, "columns", { value: 80 });
  app.stdout.emit("resize");
  app.rerender(React.createElement(SubsetsApp, { manager }));
  const pause = () => new Promise((resolve) => setTimeout(resolve, 80));
  await pause();
  const frames = { skills: app.lastFrame() };
  app.stdin.write("3");
  await pause();
  frames.groups = app.lastFrame();
  app.stdin.write("1");
  await pause();
  app.stdin.write("/");
  await pause();
  app.stdin.write("storytelling");
  await pause();
  app.stdin.write("\r");
  await pause();
  frames.search = app.lastFrame();
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  fs.mkdirSync("site/assets", { recursive: true });
  fs.writeFileSync(
    "site/assets/tui-capture.json",
    JSON.stringify(
      {
        kind: "actual Ink component render with disposable sample skills",
        sourceCommit,
        sourceDirty: Boolean(
          execFileSync("git", ["diff", "--name-only", "--", "node/src"], {
            encoding: "utf8",
          }).trim(),
        ),
        tuiSourceSha256: createHash("sha256")
          .update(fs.readFileSync("node/src/tui.tsx"))
          .digest("hex"),
        version: JSON.parse(fs.readFileSync("package.json")).version,
        generator: "scripts/capture-tui.mjs",
        columns: 80,
        frames,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Captured Skills, Groups and Search from the real Subsets TUI.");
} finally {
  app?.unmount();
  fs.rmSync(dir, { recursive: true, force: true });
}
