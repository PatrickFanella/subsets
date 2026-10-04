import * as fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { parse } from "yaml";
import { absolute, exists } from "./storage.js";
import type { Root, Skill } from "./types.js";
export const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
export function root(
  p: string,
  client = "custom",
  scope = "explicit",
  owner = "unmanaged",
): Root {
  return {
    id: createHash("sha256").update(p).digest("hex").slice(0, 12),
    path: p,
    client,
    scope,
    owner,
  };
}
export function pathOwner(p: string) {
  if (
    p
      .split(path.sep)
      .some((n) =>
        [".system", "plugins", "node_modules", "site-packages"].includes(n),
      )
  )
    return "package";
  if (exists(p)) {
    const resolved = fs.realpathSync(p);
    if (["/usr/", "/opt/", "/nix/"].some((s) => resolved.startsWith(s)))
      return "package";
    if (fs.lstatSync(p).isSymbolicLink()) return "linked source";
  }
  return "unmanaged";
}
export function rootOwner(p: string, home: string) {
  const owner = pathOwner(p);
  if (owner !== "unmanaged") return owner;
  let parent = p;
  for (let i = 0; i < 6; i++) {
    if (
      exists(path.join(parent, "catalog/installation.json")) &&
      exists(path.join(parent, "scripts/skill-profile"))
    )
      return "codex-skills source";
    parent = path.dirname(parent);
  }
  const codex = absolute(process.env.CODEX_HOME ?? path.join(home, ".codex"));
  if (exists(path.join(p, "../../.agent-skills.json")))
    return "project installer";
  if (
    p === path.join(home, ".agents/skills") &&
    exists(path.join(home, ".agents/.skill-profile-state.json"))
  )
    return "skill-profile";
  if (
    p === path.join(codex, "skills") &&
    exists(path.join(codex, "skill-installations/codex-skills/installed.json"))
  )
    return "codex-skills installer";
  if (
    p === path.join(home, ".claude/skills") &&
    exists(
      path.join(
        home,
        ".codex/skill-installations/codex-source-links/installed.json",
      ),
    )
  )
    return "source-link installer";
  if (exists(path.join(p, ".profile-state.json"))) return "skill-profile";
  for (const parent of [p, path.dirname(p), path.dirname(path.dirname(p))])
    for (const name of ["skills-lock.json", ".skills-lock.json"])
      if (exists(path.join(parent, name))) return "external skill installer";
  if (exists(path.join(p, ".subsets-owner.json"))) return "subsets registry";
  return "unmanaged";
}
function directory(p: string) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
export function roots(
  home = os.homedir(),
  project?: string,
  extra: string[] = [],
  plugins = true,
) {
  home = absolute(home);
  const codex = absolute(process.env.CODEX_HOME ?? path.join(home, ".codex")),
    xdg = absolute(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"));
  const candidates: Array<[string, string, string]> = [
    [path.join(codex, "skills"), "codex", "user"],
    [path.join(home, ".agents/skills"), "shared", "user"],
    [path.join(home, ".claude/skills"), "claude", "user"],
    [path.join(xdg, "opencode/skills"), "opencode", "user"],
    [path.join(home, ".opencode/skills"), "opencode", "user"],
  ];
  if (project)
    for (
      let p = absolute(project);
      p !== home && path.dirname(p) !== p;
      p = path.dirname(p)
    )
      for (const [folder, client] of [
        [".agents", "shared"],
        [".codex", "codex"],
        [".claude", "claude"],
        [".opencode", "opencode"],
      ])
        candidates.push([path.join(p, folder, "skills"), client, "project"]);
  candidates.push(
    ...extra.map(
      (p) => [absolute(p), "custom", "explicit"] as [string, string, string],
    ),
  );
  candidates.push([path.join(codex, "skills/.system"), "codex", "system"]);
  if (plugins) {
    const cache = path.join(codex, "plugins/cache");
    for (const depth of [2, 3]) {
      let level = [cache];
      for (let i = 0; i < depth; i++) {
        level = level
          .flatMap((p) =>
            directory(p)
              ? fs
                  .readdirSync(p)
                  .sort()
                  .slice(0, 2000)
                  .map((n) => path.join(p, n))
                  .filter(directory)
              : [],
          )
          .slice(0, 2000);
      }
      for (const p of level)
        candidates.push([path.join(p, "skills"), "plugin", "plugin"]);
    }
  }
  const found = new Map<string, Root>();
  for (const [p, client, scope] of candidates)
    if (directory(p) && !found.has(p))
      found.set(p, root(p, client, scope, rootOwner(p, home)));
  return [...found.values()];
}
export function inspect(p: string, r: Root, expectedName?: string): Skill {
  const folder = expectedName ?? path.basename(p);
  let name = folder,
    description = "",
    issue = "";
  try {
    const entry = path.join(p, "SKILL.md");
    if (fs.statSync(entry).size > 1048576)
      throw Error("SKILL.md exceeds 1 MiB");
    const content = fs.readFileSync(entry, "utf8");
    if (!content.startsWith("---\n")) throw Error("Missing YAML frontmatter");
    const end = content.indexOf("\n---", 4);
    if (end < 0) throw Error("Unclosed YAML frontmatter");
    const data: unknown = parse(content.slice(4, end));
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw Error("Frontmatter must be a mapping");
    const row = data as Record<string, unknown>;
    if (
      typeof row.name !== "string" ||
      !NAME.test(row.name) ||
      row.name !== folder
    )
      throw Error(
        "Folder and frontmatter name must match a lowercase skill name",
      );
    name = row.name;
    if (typeof row.description !== "string" || !row.description.trim())
      throw Error("Missing description");
    description = row.description;
  } catch (e) {
    issue = e instanceof Error ? e.message : String(e);
    name = folder;
  }
  return {
    id: r.id + ":" + folder,
    name,
    description,
    path: p,
    root: r.path,
    client: r.client,
    scope: r.scope,
    owner: r.owner === "unmanaged" ? pathOwner(p) : r.owner,
    issue,
  };
}
export function scan(found: Root[]) {
  const skills: Skill[] = [],
    warnings: string[] = [];
  for (const r of found)
    try {
      const entries = fs.readdirSync(r.path).sort();
      if (entries.length > 5000)
        warnings.push("Scan limited to 5000 entries: " + r.path);
      for (const n of entries.slice(0, 5000))
        if (!n.startsWith(".") && exists(path.join(r.path, n, "SKILL.md")))
          skills.push(inspect(path.join(r.path, n), r));
    } catch (e) {
      warnings.push(r.path + ": " + String(e));
    }
  return { skills, warnings };
}
