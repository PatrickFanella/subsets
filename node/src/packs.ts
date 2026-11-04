import * as fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { Manager } from "./manager.js";
import type { Legacy } from "./legacy.js";
import {
  read,
  save,
  exists,
  inside,
  snapshot,
  payloadOperation,
} from "./storage.js";
import { SubsetsError, type Tree } from "./types.js";

// Optional skill packs Subsets can download. Each is an npm package whose
// package.json names the pack under "subsets" and holds plain skill folders.
export const PACKS: Record<string, { pkg: string; summary: string }> = {
  patstack: {
    pkg: "@subcult/patstack",
    summary:
      "48 portable agent skills for development, review, debugging, research and writing",
  },
};
export interface PackRecord {
  decision: "added" | "declined" | "removed";
  at: string;
  version?: string;
  integrity?: string;
  folder?: string;
}
export interface Download {
  dir: string;
  version: string;
  integrity: string;
}
export type Fetcher = (spec: string, dest: string) => Download;

// Downloads with the user's own npm configuration, so a scoped registry,
// proxy or offline cache applies as it does for any other package.
export function npmFetcher(spec: string, dest: string): Download {
  fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
  let out: string;
  try {
    out = execFileSync(
      "npm",
      ["pack", spec, "--json", "--pack-destination", dest],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (e) {
    const err = e as { stderr?: string; code?: string };
    const reason =
      err.code === "ENOENT"
        ? "npm is not on PATH"
        : (err.stderr ?? String(e)).trim().split("\n").pop();
    throw new SubsetsError("Could not download " + spec + ": " + reason);
  }
  const info = JSON.parse(out)[0] as {
    filename: string;
    version: string;
    integrity: string;
  };
  const unpacked = path.join(dest, "unpacked");
  fs.mkdirSync(unpacked, { mode: 0o700 });
  execFileSync("tar", [
    "-xzf",
    path.join(dest, path.basename(info.filename)),
    "-C",
    unpacked,
  ]);
  return {
    dir: path.join(unpacked, "package"),
    version: info.version,
    integrity: info.integrity,
  };
}

const file = (m: Manager) => path.join(m.store.path, "packs.json");
export const decisions = (m: Manager) =>
  read<Record<string, PackRecord>>(file(m), {});
function record(m: Manager, name: string, rec: Omit<PackRecord, "at">) {
  const d = decisions(m);
  d[name] = { ...rec, at: new Date().toISOString() };
  save(file(m), d);
}
function pack(name: string) {
  const p = PACKS[name];
  if (!p)
    throw new SubsetsError(
      "Unknown pack: " + name + "; available: " + Object.keys(PACKS).join(", "),
    );
  return p;
}

// Offer the default pack once, on an interactive first run. Hosts managed by
// the patstack backend already have these skills, so they are never asked.
export function shouldOffer(
  m: Manager,
  legacy?: Legacy,
  env: NodeJS.ProcessEnv = process.env,
) {
  return !env.SUBSETS_NO_PACK && !legacy && !decisions(m).patstack;
}
export function decline(m: Manager, name: string) {
  pack(name);
  record(m, name, { decision: "declined" });
}

function refuseLinks(tree: Tree, where: string) {
  if (tree?.type === "link")
    throw new SubsetsError("Pack contains a symlink: " + where);
  if (tree?.type === "directory")
    for (const [n, c] of Object.entries(tree.entries))
      refuseLinks(c, path.join(where, n));
}

export function add(
  m: Manager,
  name: string,
  opts: { to?: string; fetch?: Fetcher } = {},
) {
  const p = pack(name),
    base = path.join(m.store.path, "packs", name),
    tmp = path.join(base, ".download-" + process.pid + "-" + Date.now());
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  let version: string, integrity: string, folder: string;
  try {
    const got = (opts.fetch ?? npmFetcher)(p.pkg + "@latest", tmp),
      meta = read<{
        name?: string;
        subsets?: { pack?: string; skills?: string };
      }>(path.join(got.dir, "package.json"), {});
    if (meta.name !== p.pkg || meta.subsets?.pack !== name)
      throw new SubsetsError("Downloaded package is not the " + name + " pack");
    refuseLinks(snapshot(got.dir), got.dir);
    const final = path.join(base, got.version);
    if (!exists(final)) fs.renameSync(got.dir, final);
    ({ version, integrity } = got);
    folder = path.join(final, meta.subsets.skills ?? "skills");
    if (!inside(folder, final) || !exists(folder))
      throw new SubsetsError("Pack has no skills folder");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (!(folder in m.store.load().searchRoots))
    m.configureRoot(folder, "readonly");
  const offered = m
      .inventory()
      .skills.filter((s) => s.root === folder && !s.issue)
      .sort((a, b) => a.name.localeCompare(b.name)),
    managed = Object.values(m.store.load().roots),
    target = opts.to
      ? m.findRoot(opts.to)
      : managed.length === 1
        ? managed[0]
        : undefined,
    imported: string[] = [],
    skipped: string[] = [];
  let next = "Turn the pack on with: subsets apply --group " + name;
  if (target) {
    for (const s of offered) {
      const d = m.store.load(),
        existing = d.skills[target.id + ":" + s.name];
      if (existing && inside(existing.origin, base)) continue;
      if (existing || exists(path.join(target.path, s.name))) {
        skipped.push(s.name);
        continue;
      }
      m.importSkill(s.id, target.id);
      imported.push(s.name);
    }
    const members = Object.entries(m.store.load().skills)
      .filter(([, s]) => inside(s.origin, base))
      .map(([id]) => id);
    if (members.length)
      m.editGroup(
        m.store.load().groups[name] ? "add" : "create",
        name,
        members,
      );
  } else
    next = managed.length
      ? "Several folders are managed; choose one with: subsets pack add " +
        name +
        " --to ROOT_ID"
      : "Adopt a skill folder (subsets roots, then subsets adopt ROOT_ID), then run: subsets pack add " +
        name;
  record(m, name, { decision: "added", version, integrity, folder });
  return {
    pack: name,
    package: p.pkg + "@" + version,
    integrity,
    folder,
    available: offered.length,
    imported,
    skipped,
    group: m.store.load().groups[name] ? name : null,
    next,
  };
}

// Removes an inactive pack: its group, its imported copies and its folder.
export function remove(m: Manager, name: string) {
  pack(name);
  const base = path.join(m.store.path, "packs", name);
  const result = m.store.lock(() => {
    const d = m.store.load(),
      ids = Object.entries(d.skills)
        .filter(([, s]) => inside(s.origin, base))
        .map(([id]) => id);
    if (d.activeGroups.includes(name))
      throw new SubsetsError(
        "The " + name + " group is active; apply your groups without it first",
      );
    for (const id of ids) {
      const s = d.skills[id];
      if (d.roots[s.rootId].baseline[s.name])
        throw new SubsetsError(
          s.name + " is active; apply your groups without it first",
        );
    }
    const names = ids.map((id) => d.skills[id].name).sort();
    for (const id of ids) {
      const s = d.skills[id];
      delete d.roots[s.rootId].baseline[s.name];
      delete d.skills[id];
      for (const members of Object.values(d.groups))
        members.splice(0, members.length, ...members.filter((x) => x !== id));
    }
    delete d.groups[name];
    for (const folder of Object.keys(d.searchRoots))
      if (inside(folder, base)) delete d.searchRoots[folder];
    return {
      pack: name,
      removed: names,
      transaction: m.store.transaction(
        [payloadOperation(m.store.registry, snapshot(m.store.registry), d)],
        "remove pack " + name,
      ),
    };
  });
  fs.rmSync(base, { recursive: true, force: true });
  record(m, name, { decision: "removed" });
  return result;
}

export function list(m: Manager) {
  const d = decisions(m);
  return Object.entries(PACKS).map(([name, p]) => ({
    name,
    package: p.pkg,
    summary: p.summary,
    ...(d[name] ?? { decision: "not offered yet" }),
  }));
}
